; Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
; Gente: write out the server (rakazo-server.pack) with Node, which handles paths longer than
; 260 characters that NSIS would drop. See apps/desktop/scripts/gente-server-pack.cjs.
!macro customInstall
  DetailPrint "Setting up Gente..."
  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'
  nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\gente-server-pack.cjs" unpack "$INSTDIR\resources\rakazo-server.pack" "$INSTDIR\resources\rakazo-server"'
  Pop $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", p 0)i'
  ; If this fails, Gente writes the server out itself on its next start.
!macroend
