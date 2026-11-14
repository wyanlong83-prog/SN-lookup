/* 修改页面或数据后，把 VERSION 加一，可让已安装的旧缓存自动失效 */
var VERSION = 'v4';
var CACHE = 'sn-lookup-' + VERSION;

var SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './csv-import.js',
  './scandit-scan.js',
  './manifest.webmanifest',
  './vendor/jsQR.js',
  './vendor/zxing.min.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === CACHE ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  var path = url.pathname;
  /* 只有体积大且不常改的库走缓存优先，其余（HTML/JS/CSS/数据）一律网络优先，避免旧代码残留 */
  var cacheFirst = path.indexOf('/vendor/') !== -1 ||
    /\.(png|jpg|jpeg|svg|webp|ico)$/.test(path);

  if (!cacheFirst) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req, { ignoreSearch: true }).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        return res;
      });
    })
  );
});
