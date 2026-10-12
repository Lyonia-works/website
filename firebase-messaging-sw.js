// Shows go-live notifications while the site is closed.
importScripts(
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js",
);

firebase.initializeApp({
  apiKey: "AIzaSyCfa_dafxGkuZt9rqkKO4vqitidFLGXE70",
  projectId: "lyonia-website",
  messagingSenderId: "942868148119",
  appId: "1:942868148119:web:346bfb4dec74d5819dded2",
});
firebase.messaging();
