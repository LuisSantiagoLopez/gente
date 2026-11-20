#!/bin/zsh
# Same steps as the first measurement: three demo chats with streamed replies, then scrolling.
# Fixed taps (no UI Automator while measuring). Prints dumpsys gfxinfo.
A=~/Library/Android/sdk/platform-tools/adb; P=${1:-com.deskhead.gente}
$A shell dumpsys gfxinfo $P reset >/dev/null
for q in 1 2 3; do
  $A shell input tap 885 2240; sleep 1.2
  $A shell input tap 181 2265; sleep 0.8
  $A shell input text "Plan%sa%strip%snumber%s$q"; $A shell input keyevent KEYCODE_ESCAPE; sleep 0.5
  $A shell input tap 979 2271; sleep 7
  $A shell input tap 74 226; sleep 1.5
done
for s in 1 2 3; do $A shell input swipe 540 1800 540 600 250; sleep 0.3; $A shell input swipe 540 600 540 1800 250; sleep 0.3; done
$A shell dumpsys gfxinfo $P | grep -E "Total frames rendered|Janky frames|50th percentile|90th percentile|95th percentile|99th percentile|Number Slow UI|Number Frame deadline missed|Number Slow bitmap|Number Slow issue|Number High input"
