/* ── FIREBASE ── */
const FC = {
  apiKey: "AIzaSyDxDzLbCnqYYVknoyHMzbE0gB_SRVLpgiw",
  authDomain: "kyky-c3471.firebaseapp.com",
  databaseURL: "https://kyky-c3471-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kyky-c3471",
  storageBucket: "kyky-c3471.firebasestorage.app",
  messagingSenderId: "658643330578",
  appId: "1:658643330578:web:758dc26d5504a503e39acb"
};
firebase.initializeApp(FC);
const auth = firebase.auth();
const db   = firebase.database();

/* ── ICE ── */
const ICE_CFG = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
]};

/* ── CONSTANTS ── */
const AVATARS = ['basic1.png','basic2.png','basic3.png','basic4.png','basic5.png','basic6.png'];
const randAv  = () => AVATARS[Math.floor(Math.random() * AVATARS.length)];
const MSG_LIMIT = 2000;
const TENOR_KEY = 'LIVDSRZULELA'; // Tenor demo key

/* ── GLOBAL STATE ── */
// Auth
var CU       = null;   // currentUser (Firebase auth)
var myData   = null;   // user's Firestore data
var myFriends = {};    // uid → true

// Chat
var chatId      = null;
var chatIsGroup = false;
var chatTarget  = null;
var isInitialLoad = true;
var _rTO = null;

// Realtime listeners (kept to detach on chat switch)
var msgRef        = null;
var typingRef     = null;
var typingTO      = null;
var activeCallRef = null;
var partRef       = null;

// Unread
var lastReadCache = {}; // chatId → ts

// Reply
var replyCtx = null; // { msgId, pseudo, text }

// Edit
var editingMsgId = null;

// Groups/profile misc
var groupId    = null;
var groupOwner = null;
var tempUid    = null;
var isOwnModal = false;
var allUsers   = [];
var addMemberCache  = [];
var grpFriendsCache = [];
var selMembers      = [];

// Notifications
var notifOn = localStorage.getItem('kychat_notif') === 'on';
var swReg   = null;

// WebRTC
var pc              = null;
var localStream     = null;
var micOn           = true;
var camOn           = false;
var callId          = null;
var callChatId      = null;
var callRemoteUid   = null;
var isCaller        = false;
var iceBuf          = [];
var remoteReady     = false;
var incomingData    = null;
var remoteVideoStreams = {};
var partSnap        = {};
var prevPartKeys    = new Set();
var ringAudio       = null;
var timerIv         = null;
var timerStart      = null;
var missedTO        = null;
var callMinimized   = false;

// Audio context
var audioCtx = null;
