#!/bin/zsh
# Usage: screens.sh <locale> <outdir>. Drives the real debug app on the emulator.
set -u
L=$1; OUT=$2; mkdir -p $OUT
A=~/Library/Android/sdk/platform-tools/adb; U="${0:A:h}/ui.py"; PKG=com.deskhead.gente.debug
$A shell settings put global sysui_demo_allowed 1
$A shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
$A shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null
$A shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
$A shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 >/dev/null
$A shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null
$A shell pm clear $PKG >/dev/null
$A shell cmd locale set-app-locales $PKG --locales $L
typeset -A S
case $L in
  es) S=(try "Probar primero" newchat "Nuevo chat" chat1 "Fin de semana en CDMX" where "Dónde corre la IA" data "Dónde están mis datos" whatleft "Lo que salió de tu teléfono" settings "Ajustes" plan "Plan" back "Atrás" pair "Vincular tu computadora" hint "Pregúntale a Gente" approve "Sí, hazlo");;
  pt) S=(try "Experimentar primeiro" newchat "Nova conversa" chat1 "Fim de semana em SP" where "Onde a IA roda" data "Onde estão meus dados" whatleft "O que saiu do seu celular" settings "Configurações" plan "Plano" back "Voltar" pair "Conectar seu computador" hint "Pergunte ao Gente" approve "Sim, pode fazer");;
  *) S=(try "Try it first" newchat "New chat" chat1 "Weekend in Mexico City" where "Where the AI runs" data "Where's my data" whatleft "What left your phone" settings "Settings" plan "Plan" back "Back" pair "Pair your computer" hint "Ask Gente" approve "Yes, do it");;
esac
$A shell am start -W -n $PKG/com.deskhead.gente.MainActivity >/dev/null; sleep 2.5
$U shot $OUT/01-welcome.png
$A shell am force-stop $PKG
$A shell am start -W -n $PKG/com.deskhead.gente.StoreArtActivity --ez seed true >/dev/null; sleep 1.5
$A shell am start -W -n $PKG/com.deskhead.gente.MainActivity >/dev/null; sleep 2
$U shot $OUT/02-home.png
$U tap "${S[chat1]}"; sleep 2.5
$U shot $OUT/03-chat.png
$U tap "${S[where]}"; sleep 2
$U shot $OUT/04-where-ai-runs.png
$A shell input keyevent KEYCODE_BACK; sleep 1
$A shell am start -n $PKG/com.deskhead.gente.StoreArtActivity --ez approval true >/dev/null; sleep 2.5
$U shot $OUT/05-approval.png
$U tap "${S[approve]}"; sleep 1
$U home "${S[settings]}"
$U tap "${S[data]}"; sleep 2
$U shot $OUT/06-wheres-my-data.png
$U tap "${S[whatleft]}"; sleep 1.2
$U shot $OUT/07-what-left-your-phone.png
$U home "${S[settings]}"
$U tap "${S[settings]}" exact; sleep 2
$U shot $OUT/08-settings.png
$U tap "${S[pair]}"; sleep 2
$U shot $OUT/09-pair-computer.png
$A shell input keyevent KEYCODE_BACK; sleep 1
$A shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null
