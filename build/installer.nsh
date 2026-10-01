; NSIS customization, pulled in by electron-builder via build.nsis.include.
;
; Why this exists: electron-builder's generated uninstaller only removes its own
; install directory. This app keeps all user state -- accounts.json plus one
; full browser profile per account -- in %LOCALAPPDATA%\DouyinAccountHub, which
; is outside the install directory. Without this macro, uninstalling would leave
; those gigabytes behind and silently contradict what the user was told
; ("uninstalling also removes the login state").
;
; Keep this file ASCII-only, for the same reason as the .cmd and .ps1 files:
; NSIS reads it with the ANSI code page and non-ASCII text turns into garbage.

!macro customUnInstall
  DetailPrint "Removing user data..."
  ; Remove only the data directory, then remove the parent only if it is now
  ; empty. Deleting the whole folder recursively would also wipe the runtime of
  ; a coexisting manual install (install.cmd puts it in the same parent), which
  ; is more than the user asked for. The non-recursive RMDir degrades safely:
  ; if something else still lives there, it simply fails and leaves it alone.
  RMDir /r "$LOCALAPPDATA\DouyinAccountHub\data"
  RMDir "$LOCALAPPDATA\DouyinAccountHub"
!macroend
