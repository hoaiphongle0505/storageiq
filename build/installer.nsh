; Uninstall cleanup for the two Options registry entries (electron-builder picks this file up from
; buildResources and calls customUnInstall from the uninstall section).
;
; An update runs the old uninstaller silently with --updated: ${isUpdated} is true then, and the
; entries must survive it, because the new version installs to the same path.
;
; Only the current hive is cleaned. A per-machine uninstall runs elevated, so HKCU is then the
; elevating account's hive; other users of that install keep a harmless stale menu entry
; (see docs/RELEASING.md).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\Directory\shell\StorageIQ"
    DeleteRegKey HKCU "Software\Classes\Drive\shell\StorageIQ"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\StorageIQ"
    DeleteRegValue HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endIf}
!macroend
