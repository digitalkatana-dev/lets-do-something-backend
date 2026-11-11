const { Router } = require('express');
const { model } = require('mongoose');
const {
  buildInviteCopy,
  matchesGuest,
  resolveGuest,
  sendInvite,
} = require('../util/helpers');
const requireAuth = require('../middleware/requireAuth');
const Profile = model('Profile');
const User = model('User');
const Event = model('Event');
const router = Router();

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

// Get Profile(s)
router.get('/api/profiles', requireAuth, async (req, res) => {
  let errors = {};

  try {
    const hasId = req?.query?.id;
    const hasSearch = req?.query?.search;
    let userData;

    if (hasId) {
      userData = await Profile.findById(hasId)
        .populate('friends')
        .populate('myEvents')
        .populate({ path: 'myEvents', populate: { path: 'createdBy' } })
        .populate('eventsAttending')
        .populate({ path: 'eventsAttending', populate: { path: 'createdBy' } })
        .populate({ path: 'profile', populate: { path: 'myMemories' } });
    } else if (hasSearch) {
      userData = await Profile.find({
        $and: [
          {
            $or: [
              { firstName: { $regex: hasSearch, $options: 'i' } },
              { lastName: { $regex: hasSearch, $options: 'i' } },
            ],
          },
          {
            user: { $ne: req?.user?._id },
          },
        ],
      })
        .populate('friends')
        .populate('myEvents')
        .populate({ path: 'myEvents', populate: { path: 'createdBy' } })
        .populate('eventsAttending')
        .populate({ path: 'eventsAttending', populate: { path: 'createdBy' } })
        .populate({ path: 'profile', populate: { path: 'myMemories' } });
    } else {
      userData = await Profile.find({})
        .populate('friends')
        .populate('myEvents')
        .populate({ path: 'myEvents', populate: { path: 'createdBy' } })
        .populate('eventsAttending')
        .populate({ path: 'eventsAttending', populate: { path: 'createdBy' } })
        .populate({ path: 'profile', populate: { path: 'myMemories' } });
    }

    res.json(userData);
  } catch (err) {
    console.log('Get Profiles Error: ', err);
    errors.profiles = 'Error getting profile(s)!';
    return res.status(500).json(errors);
  }
});

// Find 1
router.post('/api/profiles/find', requireAuth, async (req, res) => {
  let errors = {};

  try {
    let user;
    let userData;

    const { guest } = req?.body;

    if (isEmail(guest)) {
      user = await Profile.findOne({ email: guest });

      if (user) {
        userData = user;
      } else {
        userData = {
          _id: guest,
          email: guest,
          notify: 'email',
        };
      }
    } else if (isPhone(guest)) {
      user = await Profile.findOne({ phone: guest });

      if (user) {
        userData = user;
      } else {
        userData = {
          _id: guest,
          phone: guest,
          notify: 'sms',
        };
      }
    }

    res.json(userData);
  } catch (err) {
    console.log('Find Profile Error: ', err);
    errors.profiles = 'Error finding profile!';
    return res.status(500).json(errors);
  }
});

// Update Profile
router.put('/api/profiles/:id/update', requireAuth, async (req, res) => {
  let errors = {};

  try {
    const { id } = req?.params;

    const updated = await Profile.findByIdAndUpdate(
      id,
      {
        $set: req?.body,
      },
      {
        returnDocument: 'after',
      },
    )
      .populate('friends')
      .populate('myEvents')
      .populate({ path: 'myEvents', populate: { path: 'createdBy' } })
      .populate('eventsAttending')
      .populate({ path: 'eventsAttending', populate: { path: 'createdBy' } })
      .populate({ path: 'profile', populate: { path: 'myMemories' } });

    if (!updated) {
      errors.profile = 'Error, profile not found!';
      return res.status(404).json(errors);
    }

    res.json({ updated, success: 'User updated successfully!' });
  } catch (err) {
    errors.profile = 'Error updating user!';
    return res.status(500).json(errors);
  }
});

// Add/Remove Friend
router.put('/api/profiles/:id/friends', requireAuth, async (req, res) => {
  let errors = {};

  try {
    let { id } = req?.params;

    const user = await Profile.findOne({ user: req?.user?._id });
    const friend = await Profile.findById(id);

    if (!friend) {
      errors.profile = 'Error, user not found!';
      return res.status(404).json(errors);
    }

    const friends = user.friends;
    const areFriends = friends?.includes(id);
    const option = areFriends ? '$pull' : '$push';

    const updated = await Profile.findByIdAndUpdate(
      user?._id,
      {
        [option]: { friends: id },
      },
      {
        returnDocument: 'after',
      },
    )
      .populate('friends')
      .populate('myEvents')
      .populate({ path: 'myEvents', populate: { path: 'createdBy' } })
      .populate('eventsAttending')
      .populate({ path: 'eventsAttending', populate: { path: 'createdBy' } })
      .populate({ path: 'profile', populate: { path: 'myMemories' } });

    res.json({
      updated,
      success: 'Friend added/removed successfully!',
    });
  } catch (err) {
    errors.profile = 'Error adding/removing friend!';
    return res.status(500).json(errors);
  }
});

// Find And Invite
router.post('/api/profiles/find-and-invite', requireAuth, async (req, res) => {
  const { guest, eventId, type, date, time, notes } = req.body ?? {};

  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ profiles: 'Event not found!' });
    }

    const guestData = await resolveGuest(guest);
    if (!guestData) {
      return res.status(400).json({ profiles: 'Guest not found!' });
    }

    const isInvited = event.invitedGuests.some(matchesGuest(guest));
    const operator = isInvited ? '$pull' : '$push';

    const updated = await Event.findByIdAndUpdate(
      eventId,
      { [operator]: { invitedGuests: guestData } },
      { new: true },
    ).populate('createdBy');

    if (!isInvited) {
      const hostProfile = await Profile.findOne({ user: req.user?._id });
      const host = `${hostProfile?.firstName} ${hostProfile?.lastName}`;
      const copy = buildInviteCopy({ type, date, time, host });

      await sendInvite(guestData, copy, { notes, eventLabel: updated.label });
    }

    res.json({
      updated,
      success: isInvited
        ? 'Guest removed successfully!'
        : 'Guest invited successfully!',
    });
  } catch (err) {
    console.error('Invite Error:', err);
    res.status(500).json({ profiles: 'Error sending invite!' });
  }
});

// Delete User
router.delete('/api/profiles/:id/delete', requireAuth, async (req, res) => {
  let errors = {};

  try {
    const { id } = req?.params;

    const deletedProfile = await Profile.findByIdAndDelete(id);

    if (!deletedProfile) {
      errors.profiles = 'Error, user not found!';
      return res.status(404).json(errors);
    }

    await User.findByIdAndDelete(deletedProfile.user);
    res.json({ deletedProfile, success: 'User deleted successfully!' });
  } catch (err) {
    console.log(err);
    errors.profiles = 'Error deleting user!';
    return res.status(500).json(errors);
  }
});

module.exports = router;
