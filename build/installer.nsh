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

; Branded welcome page and finish texts (the finish page uses the same side image, build/installerSidebar.bmp;
; header image build/installerHeader.bmp). Both made by scripts/make-installer-art.py at 2x so they stay sharp.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to MyLecture"
  !define MUI_WELCOMEPAGE_TEXT "Turn your ideas into narrated, animated videos, right on your PC.$\r$\n$\r$\nSetup installs MyLecture ${VERSION} and, if you want, the AI engines and voices it uses. It takes a few minutes.$\r$\n$\r$\nClick Next to begin."
  !insertmacro MUI_PAGE_WELCOME
  ; Finish page texts (MUI reads these when electron-builder adds its finish page later on).
  !define MUI_FINISHPAGE_TITLE "MyLecture is ready"
  !define MUI_FINISHPAGE_TEXT "MyLecture ${VERSION} is installed.$\r$\n$\r$\nOpen MyLecture and sign in to an AI engine to start making videos. You can add engines and voices any time in Settings."
  ; Ask before quitting halfway.
  !define MUI_ABORTWARNING
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
    !insertmacro MUI_HEADER_TEXT "AI engines and voices" "Pick what MyLecture should set up for you."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ; Bold section headings (visual only; $1 holds the font handle).
    CreateFont $1 "$(^Font)" "$(^FontSize)" 700
    ${NSD_CreateLabel} 0 0 100% 10u "AI engines  -  you sign in with your own account"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $1 0
    ${NSD_CreateCheckbox} 8u 13u -8u 11u "Claude  (Claude Code)  -  Claude Pro or Max plan"
    Pop $CbClaude
    ${NSD_SetState} $CbClaude $EngClaude
    ${NSD_CreateCheckbox} 8u 26u -8u 11u "GPT  (Codex)  -  ChatGPT Plus, Pro, Business or Enterprise"
    Pop $CbCodex
    ${NSD_SetState} $CbCodex $EngCodex
    ${NSD_CreateCheckbox} 8u 39u -8u 11u "Gemini  (Antigravity)  -  any Google account"
    Pop $CbAgy
    ${NSD_SetState} $CbAgy $EngAgy
    ${NSD_CreateLabel} 0 58u 100% 10u "Narration voices"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $1 0
    ${NSD_CreateCheckbox} 8u 71u -8u 11u "Kokoro  -  fast, natural voice  (about 325 MB)"
    Pop $CbKokoro
    ${NSD_SetState} $CbKokoro $EngKokoro
    ${NSD_CreateCheckbox} 8u 84u -8u 11u "OmniVoice  -  high-quality, expressive voice  (about 6 GB)"
    Pop $CbOmni
    ${NSD_SetState} $CbOmni $EngOmni
    ${NSD_CreateHLine} 0 103u 100% 1u ""
    Pop $0
    ${NSD_CreateLabel} 0 109u 100% 24u "Needs an internet connection. Files come from Anthropic, OpenAI, Google, Hugging Face and PyPI. Anything you skip can be added later in Settings."
    Pop $0
    SetCtlColors $0 666666 transparent
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
