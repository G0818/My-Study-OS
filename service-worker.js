// ===============================
// My Study OS service-worker.js
// - 오프라인 캐시
// - FCM Web Push 백그라운드 알림
// ===============================

// ---- 1) 기본 캐시 설정 ----
const CACHE_VERSION = "v3";
const CACHE_NAME = `my-study-os-cache-${CACHE_VERSION}`;

// 필요하다면 여기에 미리 캐시할 파일들을 추가
const ASSETS_TO_CACHE = [
  "/My-Study-OS/",
  "/My-Study-OS/index.html",
  "/My-Study-OS/manifest.json",
  "/My-Study-OS/icon-192.png",
  "/My-Study-OS/icon-512.png"
];

// 설치 시 기본 파일 캐시
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => null);
    })
  );
  self.skipWaiting();
});

// 활성화 시 예전 캐시 정리
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      )
    )
  );
  self.clients.claim();
});

// fetch 핸들러: 네트워크 우선, 실패하면 캐시
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// ---- 2) Firebase Messaging (FCM) 설정 ----

// service worker에서는 compat 버전 사용
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js");

// V5.html에 쓰고 있는 것과 같은 firebaseConfig
firebase.initializeApp({
  apiKey: "AIzaSyC-OtOZzkLk1f70wWegmv2zDcCJqlFZlLA",
  authDomain: "my-study-os-3758c.firebaseapp.com",
  projectId: "my-study-os-3758c",
  storageBucket: "my-study-os-3758c.firebasestorage.app",
  messagingSenderId: "632448831360",
  appId: "1:632448831360:web:bd8f776773cdfc72f93b65",
  measurementId: "G-VD3P1XY2E7"
});

// FCM 인스턴스
const messaging = firebase.messaging();

// ---- 3) 백그라운드 푸시 수신 처리 ----
// 서버(Cloud Functions 등)에서 FCM을 보내면
// 앱이 닫혀 있어도 이 SW가 메시지를 받아서 알림을 표시함
messaging.onBackgroundMessage((payload) => {
  console.log("[My Study OS] 백그라운드 메시지 수신:", payload);

  const notificationTitle =
    (payload.notification && payload.notification.title) ||
    "My Study OS";

  const notificationOptions = {
    body:
      (payload.notification && payload.notification.body) ||
      "",
    icon: "/My-Study-OS/icon-192.png",
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 알림 클릭 시 처리 (원하는 대로 수정 가능)
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const urlToOpen = "/My-Study-OS/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 이미 열려 있는 탭이 있으면 거기로 포커스
      for (const client of clientList) {
        if (client.url.includes("/My-Study-OS/") && "focus" in client) {
          return client.focus();
        }
      }
      // 없으면 새 탭 열기
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
