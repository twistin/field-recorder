[app]
title = Field Recorder Pro
package.name = fieldrecorderpro
package.domain = org.example
source.dir = .
source.include_exts = py,png,jpg,kv,atlas,json,wav
version = 0.1
requirements = python3,kivy,plyer,android
orientation = portrait
osx.python_version = 3
osx.kivy_version = 1.9.1
fullscreen = 0
android.permissions = RECORD_AUDIO, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, WRITE_EXTERNAL_STORAGE, READ_EXTERNAL_STORAGE
android.api = 31
android.minapi = 21
android.sdk = 31
android.ndk = 23b
android.archs = arm64-v8a, armeabi-v7a
android.allow_backup = True
p4a.branch = master

[buildozer]
log_level = 2
warn_on_root = 1
