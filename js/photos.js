// Delivery-photo persistence via IndexedDB, keyed by stop id. localStorage only
// holds the JSON state blob (via storage.js) — photo Blobs live here instead so
// they survive reload without bloating that blob or hitting its size limits.

const PHOTO_DB_NAME = 'runsheet-photos';
const PHOTO_STORE = 'photos';
let photoDbPromise = null;

function openPhotoDb(){
  if(photoDbPromise) return photoDbPromise;
  photoDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(PHOTO_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return photoDbPromise;
}

async function savePhoto(stopId, blob){
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).put(blob, stopId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPhoto(stopId){
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(PHOTO_STORE, 'readonly').objectStore(PHOTO_STORE).get(stopId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deletePhoto(stopId){
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).delete(stopId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearAllPhotos(){
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
