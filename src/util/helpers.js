const { model, isValidObjectId } = require('mongoose');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const Profile = model('Profile');

const sgMail = require('@sendgrid/mail');
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const isEmail = (data) => {
  const regEx =
    /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  if (data?.match(regEx)) return true;
  else return false;
};

const isPhone = (data) => {
  const regEx = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
  if (data?.match(regEx)) return true;
  else return false;
};

const INVITATION_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'emails', 'invitation.html'),
  'utf-8',
);
const RSVP_URL = 'https://letsdosomething.net';

const getEventPhrase = (type) => {
  if (type === 'Party') return `a ${type}`;
  if (type === 'Movies') return `the ${type}`;
  return type;
};

exports.buildInviteCopy = ({ type, date, time, host }) => {
  const phrase = getEventPhrase(type);
  const emailOpener = `You've been invited to ${phrase} on ${date} at ${dayjs(time).format('h:mm a')} by ${host}.`;

  return {
    subject: `You've been invited to ${phrase}!`,
    emailOpener,
    smsMessage: `${emailOpener} Click here -> ${RSVP_URL} to RSVP!`,
  };
};

exports.matchesGuest = (guest) => (item) =>
  [item._id, item.email, item.phone].some(
    (value) => value != null && String(value) === String(guest),
  );

exports.resolveGuest = async (guest) => {
  if (isEmail(guest)) {
    const profile = await Profile.findOne({ email: guest });
    return profile ?? { _id: guest, email: guest, notify: 'email' };
  }
  if (isPhone(guest)) {
    const profile = await Profile.findOne({ phone: guest });
    return profile ?? { _id: guest, phone: guest, notify: 'sms' };
  }
  if (isValidObjectId(guest)) {
    return Profile.findById(guest);
  }
  return null;
};

exports.sendInvite = async (guest, copy, { notes, eventLabel }) => {
  if (guest.notify === 'sms') {
    await twilioClient.messages.create({
      body: copy.smsMessage,
      from: process.env.TWILIO_NUMBER,
      to: `+1${guest.phone}`,
    });
    return;
  }

  if (guest.notify === 'email') {
    const html = INVITATION_TEMPLATE.replaceAll(
      '{{emailOpener}}',
      copy.emailOpener,
    )
      .replaceAll('{{notes}}', notes ?? '')
      .replaceAll('{{label}}', eventLabel);

    await sgMail.send({
      to: guest.email,
      from: process.env.SG_BASE_EMAIL,
      subject: copy.subject,
      html,
    });
  }
};
