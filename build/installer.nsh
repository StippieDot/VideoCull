!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
Var VideoCullDesktopShortcutCheckbox
Var VideoCullStartMenuShortcutCheckbox
Var VideoCullDesktopShortcut
Var VideoCullStartMenuShortcut

!macro customInit
  StrCpy $VideoCullDesktopShortcut ${BST_CHECKED}
  StrCpy $VideoCullStartMenuShortcut ${BST_CHECKED}
!macroend

!macro customPageAfterChangeDir
  Function VideoCullOptionsCreate
    ${If} ${Silent}
      Abort
    ${EndIf}

    ClearErrors
    ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VideoCullDesktopShortcut
    ${IfNot} ${Errors}
      StrCpy $VideoCullDesktopShortcut $0
    ${EndIf}

    ClearErrors
    ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VideoCullStartMenuShortcut
    ${IfNot} ${Errors}
      StrCpy $VideoCullStartMenuShortcut $0
    ${EndIf}

    ${If} ${isUpdated}
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "VideoCull shortcuts" "Choose where setup creates shortcuts."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 22u "Create shortcuts for quick access to VideoCull."
    Pop $0

    ${NSD_CreateCheckbox} 0 34u 100% 14u "Create a Desktop shortcut"
    Pop $VideoCullDesktopShortcutCheckbox
    ${NSD_SetState} $VideoCullDesktopShortcutCheckbox $VideoCullDesktopShortcut

    ${NSD_CreateCheckbox} 0 58u 100% 14u "Create a Start Menu shortcut"
    Pop $VideoCullStartMenuShortcutCheckbox
    ${NSD_SetState} $VideoCullStartMenuShortcutCheckbox $VideoCullStartMenuShortcut

    nsDialogs::Show
  FunctionEnd

  Function VideoCullOptionsLeave
    ${NSD_GetState} $VideoCullDesktopShortcutCheckbox $VideoCullDesktopShortcut
    ${NSD_GetState} $VideoCullStartMenuShortcutCheckbox $VideoCullStartMenuShortcut
  FunctionEnd

  Page custom VideoCullOptionsCreate VideoCullOptionsLeave
!macroend

!macro customInstall
  ${If} ${Silent}
    ClearErrors
    ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VideoCullDesktopShortcut
    ${IfNot} ${Errors}
      StrCpy $VideoCullDesktopShortcut $0
    ${EndIf}

    ClearErrors
    ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VideoCullStartMenuShortcut
    ${IfNot} ${Errors}
      StrCpy $VideoCullStartMenuShortcut $0
    ${EndIf}
  ${EndIf}

  ${If} $VideoCullDesktopShortcut != ${BST_CHECKED}
    Delete "$newDesktopLink"
  ${EndIf}

  ${If} $VideoCullStartMenuShortcut != ${BST_CHECKED}
    Delete "$newStartMenuLink"
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Delete "$DESKTOP\Video Cull.lnk"
    Delete "$SMPROGRAMS\Video Cull.lnk"
    Delete "$INSTDIR\Video Cull.exe"
    Delete "$INSTDIR\Uninstall Video Cull.exe"
  ${EndIf}

  WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VideoCullDesktopShortcut $VideoCullDesktopShortcut
  WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VideoCullStartMenuShortcut $VideoCullStartMenuShortcut
!macroend
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnInstall
  Delete "$DESKTOP\Video Cull.lnk"
  Delete "$SMPROGRAMS\Video Cull.lnk"
  Delete "$INSTDIR\Video Cull.exe"
  Delete "$INSTDIR\Uninstall Video Cull.exe"
!macroend
!endif
