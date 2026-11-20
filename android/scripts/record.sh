#!/bin/zsh
# Records a real walk-through of the debug app on the emulator.
set -u
OUT=$1; A=~/Library/Android/sdk/platform-tools/adb; U="${0:A:h}/ui.py"; PKG=com.deskhead.gente.debug
$A shell pm clear $PKG >/dev/null
$A shell cmd locale set-app-locales $PKG --locales en
$A shell am start -W -n $PKG/com.deskhead.gente.MainActivity >/dev/null; sleep 2
$A shell screenrecord --time-limit 60 --bit-rate 8000000 /sdcard/gente.mp4 &
REC=$!; sleep 1.5
$U tap "Try it first"; sleep 1.5
$U tap "New chat"; sleep 1.5
$U tap "Ask Gente"; sleep 0.8; $A shell input text "What%scan%syou%sdo%sfor%sme?"; sleep 0.8
$U tap "Send"; sleep 7
$U tap "Where the AI runs"; sleep 2.5
$A shell input keyevent KEYCODE_BACK; sleep 1.2
$A shell input keyevent KEYCODE_BACK; sleep 0.5
$U tap "Report"; sleep 2; $A shell input keyevent KEYCODE_BACK; sleep 1
$A shell input keyevent KEYCODE_BACK; sleep 1.5
$U tap "Where's my data"; sleep 2.5
$A shell input swipe 540 1800 540 900 300; sleep 1; $U tap "Every request"; sleep 2.5
$A shell input keyevent KEYCODE_BACK; sleep 1; $A shell input keyevent KEYCODE_BACK; sleep 1.5
wait $REC
$A pull /sdcard/gente.mp4 $OUT >/dev/null && echo "saved $OUT"
