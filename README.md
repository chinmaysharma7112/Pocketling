# Pocketling

A pet that lives off the phone it is sitting on. Low battery makes it hungry, charging feeds it, a dark room puts it to sleep, a shake makes it dizzy, a loud moment startles it, and turning the phone face-down makes it hide. Walking brings back souvenirs. There is no account, no ads, and no server.

Flutter is not installed here. The app is a self-contained web page, and the Android project is a WebView shell around that page. The shell is the only place the real light sensor and step counter are available. On a computer, the Pocket screen stands in for the sensors.

## Preview on this computer

```powershell
node tools/serve.js
```

Open http://127.0.0.1:4173 . Say hello, then use Pocket to drain the battery, darken the room, shake, make a noise, flip the phone, or add a practice stroll.

## Android

The debug app is built from `android/`. It does not request internet. The microphone is used only while the app is open, and only to turn sound into a loudness number. Samples are discarded.

```powershell
cd android
.\gradlew.bat assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it with Android Studio or `adb install -r` that file.

A Play upload needs a signed app bundle. Create a keystore outside the repo, then add a release signing config before `bundleRelease`. Do not commit the keystore.

If the Play Console account is a personal one created recently, Google can require a closed test with about 12 testers for 14 days before production. Check Production access and start that test early. The app uses the microphone, so the store listing needs the privacy policy in `web/privacy.html`. Put your contact email in that page before you publish. Host it on something like GitHub Pages and paste the URL into Play Console.

Data safety, answered from what the app actually does:

- Audio is processed on the device and not stored or shared.
- Steps are stored on the device and not shared.
- Nothing is sent to a server. There is no account.

## Mood order

Face-down, then a loud noise, then a shake, then darkness, then a low battery that is not charging, then charging, then a recent walk, then content. Souvenirs unlock every 40 steps, up to 12. Coats open at 0, 2, 5, and 8 souvenirs.
