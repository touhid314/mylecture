; MyLecture installer additions (electron-builder includes build/installer.nsh).
;
; Adds an "AI engines and voices" page after the install-folder page:
; Claude, GPT (Codex), Gemini (Antigravity) and the Kokoro voice are ticked by
; default; OmniVoice (large) is not. After MyLecture's files are installed, the
; installer runs `MyLecture.exe --setup-components=<ticked ids>`, which installs
; them with the same code the app uses in Settings and on its welcome screen
; (electron/components.js), showing a progress window. Anything unticked or
; failed can be installed later from Settings -> AI engines & voices.
; Updates (silent or --updated) skip the page and install nothing extra.

; Branded welcome page (the finish page uses the same side image). The side image is build/installerSidebar.bmp
; (made from app/assets by a small script; 2x size so it stays sharp).
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to MyLecture"
  !define MUI_WELCOMEPAGE_TEXT "Turn your ideas into narrated, animated videos, right on your PC.$\r$\n$\r$\nThis installs MyLecture ${VERSION} and, if you like, the AI engines and voices it uses.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Var EngInit
  Var EngClaude
  Var EngCodex
  Var EngAgy
  Var EngKokoro
  Var EngOmni
  Var CbClaude
  Var CbCodex
  Var CbAgy
  Var CbKokoro
  Var CbOmni

  Page custom EnginesPageCreate EnginesPageLeave

  Function EnginesPageCreate
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} $EngInit != "1"
      StrCpy $EngInit "1"
      StrCpy $EngClaude ${BST_CHECKED}
      StrCpy $EngCodex ${BST_CHECKED}
      StrCpy $EngAgy ${BST_CHECKED}
      StrCpy $EngKokoro ${BST_CHECKED}
      StrCpy $EngOmni ${BST_UNCHECKED}
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "AI engines and voices" "Choose what to install with MyLecture."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 20u "AI engines use your own account, which you sign in to from MyLecture. Anything you skip can be installed later in Settings."
    Pop $0
    ${NSD_CreateCheckbox} 0 24u 100% 11u "Claude (Claude Code) - needs a Claude Pro or Max plan"
    Pop $CbClaude
    ${NSD_SetState} $CbClaude $EngClaude
    ${NSD_CreateCheckbox} 0 38u 100% 11u "GPT (Codex) - needs a ChatGPT Plus, Pro, Business or Enterprise plan"
    Pop $CbCodex
    ${NSD_SetState} $CbCodex $EngCodex
    ${NSD_CreateCheckbox} 0 52u 100% 11u "Gemini (Antigravity) - needs a Google account"
    Pop $CbAgy
    ${NSD_SetState} $CbAgy $EngAgy
    ${NSD_CreateCheckbox} 0 72u 100% 11u "Kokoro voice - the default narration voice (about 325 MB)"
    Pop $CbKokoro
    ${NSD_SetState} $CbKokoro $EngKokoro
    ${NSD_CreateCheckbox} 0 86u 100% 11u "OmniVoice - advanced voices, best with an NVIDIA graphics card (about 6 GB)"
    Pop $CbOmni
    ${NSD_SetState} $CbOmni $EngOmni
    ${NSD_CreateLabel} 0 106u 100% 20u "Downloads come from Anthropic, OpenAI, Google, Hugging Face and PyPI, and need an internet connection."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function EnginesPageLeave
    ${NSD_GetState} $CbClaude $EngClaude
    ${NSD_GetState} $CbCodex $EngCodex
    ${NSD_GetState} $CbAgy $EngAgy
    ${NSD_GetState} $CbKokoro $EngKokoro
    ${NSD_GetState} $CbOmni $EngOmni
  FunctionEnd
!macroend

!macro EngAdd STATE ID
  ${If} ${STATE} == ${BST_CHECKED}
    ${If} $R9 == ""
      StrCpy $R9 "${ID}"
    ${Else}
      StrCpy $R9 "$R9,${ID}"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    StrCpy $R9 ""
    !insertmacro EngAdd $EngClaude "claude-code"
    !insertmacro EngAdd $EngCodex "codex"
    !insertmacro EngAdd $EngAgy "antigravity"
    !insertmacro EngAdd $EngKokoro "kokoro"
    !insertmacro EngAdd $EngOmni "omnivoice"
    ${If} $R9 != ""
      DetailPrint "Installing AI engines and voices: $R9"
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --setup-components=$R9' $0
      DetailPrint "AI engines and voices setup finished (exit code $0)."
    ${EndIf}
  ${EndIf}
!macroend
