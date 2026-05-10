"""
requirements:
pip install google-genai, openai, moviepy==1.0.3
"""


import os
import re
import json
import base64
import time
import shutil
from typing import Optional, List, Dict, Any

from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file

from logger import Logger 

# --- API CLIENTS & UTILITIES ---
try:
    from openai import OpenAI
except ImportError:
    print("OpenAI library not found. Please run 'pip install openai'")
    OpenAI = None

from google import genai
from google.genai import types

try:
    import cv2
    from PIL import Image
    import io
except ImportError:
    print("OpenCV or Pillow not found. Please run 'pip install opencv-python Pillow' for video support.")
    cv2 = None
    Image = None
    io = None

try:
    import moviepy.editor as mp
except ImportError:
    print("MoviePy library not found. Please run 'pip install moviepy' for audio extraction.")
    mp = None

class LLM_Model:
    """
    A wrapper for OpenAI (gpt-*) and Google Gemini (gemini-*) models,
    supporting system content, history, JSON output, and media/file input.
    Supports persistent file/image/video/pdf context via:
    - `system_attachments` (always included as system-level context)
    - `attachments` in `generate(...)` (per-turn, optionally stored in history)
    On successful calls, `generate` returns either a string or parsed JSON;
    if an API call or processing step fails at runtime, it logs the error
    and returns None so callers can detect and handle failures explicitly.
    
    Requires environment variables:
    - OPENAI_API_KEY
    - GOOGLE_API_KEY
    """

    def __init__(self, 
                 model_name: str, 
                 system_content: Optional[str] = None,
                 system_attachments: Optional[List[Any]] = None,
                 return_json: bool = False,
                 max_history_messages: Optional[int] = None):
        """
        Initializes the model client.

        Args:
            model_name (str): The name of the model (e.g., "gpt-4o", "gemini-3-flash-preview").
            system_content (Optional[str]): The system prompt or instructions.
            system_attachments (Optional[List[Any]]): Persistent attachments to include
                with system context in every request. Each item can be a local file path
                string or dict like {"path": "...", "kind": "image|pdf|video|file"}.
            return_json (bool): Default setting for returning parsed JSON.
            max_history_messages (Optional[int]): Maximum number of non-system history
                messages to keep. If None, history is unbounded.
        """
        self.logger = Logger() # <-- ADDED
        self.logger.info(f"Initializing LLM_Model with model: {model_name}")

        if not all([OpenAI, genai, cv2, Image, io]):
            self.logger.critical("One or more required libraries are not installed. Please check console messages.")
            raise ImportError("One or more required libraries are not installed. Please check messages above.")
            
        self.model_name = model_name
        self.system_content = system_content
        self.system_attachments = self._normalize_attachments(system_attachments)
        self.return_json = return_json
        self.max_history_messages = max_history_messages
        if self.max_history_messages is not None and self.max_history_messages <= 0:
            self.logger.error("max_history_messages must be > 0 when provided.")
            raise ValueError("max_history_messages must be > 0 when provided.")
        
        self.history: List[Dict[str, Any]] = [] 
        self._client: Any = None
        self.api_type: str = ""

        if model_name.startswith("gpt-"):
            self.api_type = "openai"
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                self.logger.error("OPENAI_API_KEY environment variable not set.") # <-- ADDED
                raise ValueError("OPENAI_API_KEY environment variable not set.")
            self._client = OpenAI(api_key=api_key)
            self.logger.debug("OpenAI client initialized.") # <-- ADDED
            
        elif "gemini" in model_name:
            self.api_type = "google"
            api_key = os.environ.get("GOOGLE_API_KEY")
            if not api_key:
                self.logger.error("GOOGLE_API_KEY environment variable not set.") # <-- ADDED
                raise ValueError("GOOGLE_API_KEY environment variable not set.")
            # Updated to new google-genai Client API (v1.49.0+)
            self._client = genai.Client(api_key=api_key)
            self.logger.debug("Google Gemini client initialized (Client API).") # <-- ADDED
        else:
            self.logger.error(f"Unsupported model_name: {model_name}.") # <-- ADDED
            raise ValueError(f"Unsupported model_name: {model_name}. Must start with 'gpt-' or contain 'gemini'.")

    import re

    def _clean_json(self, response_string: str) -> str:
        """
        Extracts the first valid JSON object or array from a string,
        handling optional markdown code fences (e.g., ```json ... ```).
        """
        if not response_string:
            return ""

        # 1. Try to find JSON within ```json ... ``` or ``` ... ``` fences.
        #    re.DOTALL makes '.' match newline characters.
        #    This regex looks for {..} or [..] *inside* the fences.
        fence_match = re.search(
            r'```(?:json)?\s*(\{.*\}|\[.*\])\s*```', 
            response_string, 
            re.DOTALL
        )
        
        if fence_match:
            # If found, return the captured group (the JSON part)
            return fence_match.group(1)

        # 2. If no fences found, fall back to the original logic:
        #    Find the first '{...}' or '[...]' block in the *entire* string.
        json_match = re.search(r'\{.*\}|\[.*\]', response_string, re.DOTALL)
        
        if json_match:
            # If found, return the matched block
            return json_match.group(0)
        
        # 3. If no JSON-like structure is found at all, return the original string
        return response_string
    
    def _preprocess_video_for_gemini(self, video_path: str) -> Optional[str]:
        """
        Optionally resample FPS and resize height for a video before uploading to Gemini,
        using MoviePy to preserve audio.

        Controlled by env vars:
          - GEMINI_VIDEO_FPS: float (e.g., '2.0')
          - GEMINI_VIDEO_RES: int height in pixels (e.g., '360')

        Returns path to a temporary preprocessed MP4 if any change requested and successful;
        otherwise returns None (caller should use original path).
        """
        fps_env = os.getenv("GEMINI_VIDEO_FPS")
        res_env = os.getenv("GEMINI_VIDEO_RES")
        if not fps_env and not res_env:
            return None

        try:
            target_fps = float(fps_env) if fps_env else None
        except ValueError:
            self.logger.warning(f"Invalid GEMINI_VIDEO_FPS='{fps_env}', ignoring FPS change.")
            target_fps = None

        try:
            target_h = int(res_env) if res_env else None
        except ValueError:
            self.logger.warning(f"Invalid GEMINI_VIDEO_RES='{res_env}', ignoring resize.")
            target_h = None

        if target_fps is None and target_h is None:
            return None

        if mp is None:
            self.logger.warning("MoviePy not available; cannot preprocess video with audio. Using original.")
            return None

        import tempfile as _tf
        tmp = _tf.NamedTemporaryFile(suffix=".mp4", delete=False)
        tmp_path = tmp.name
        tmp.close()

        clip = None
        resized_clip = None
        try:
            clip = mp.VideoFileClip(video_path)
            orig_w, orig_h = clip.size
            new_h = target_h if target_h else orig_h
            if new_h <= 0:
                new_h = orig_h or 360
            if orig_h and orig_w:
                new_w = int(round(orig_w * (new_h / float(orig_h))))
            else:
                new_w = orig_w or new_h
            if new_w % 2 != 0:
                new_w += 1
            if new_h % 2 != 0:
                new_h += 1

            resized_clip = clip if (new_w == orig_w and new_h == orig_h) else clip.resize(newsize=(new_w, new_h))
            out_fps = target_fps if (target_fps and target_fps > 0) else getattr(clip, 'fps', None)

            # Try GPU encoder (NVENC) first, then fallback to CPU (libx264)
            tried_gpu = False
            try:
                tried_gpu = True
                resized_clip.write_videofile(
                    tmp_path,
                    fps=out_fps,
                    codec="h264_nvenc",
                    audio=True,
                    audio_codec="aac",
                    preset="fast",
                    threads=os.cpu_count() or 4,
                    verbose=False,
                    logger=None,
                )
            except Exception as e:
                self.logger.debug(f"GPU encode failed (h264_nvenc): {e}")
                resized_clip.write_videofile(
                    tmp_path,
                    fps=out_fps,
                    codec="libx264",
                    audio=True,
                    audio_codec="aac",
                    preset="medium",
                    threads=os.cpu_count() or 4,
                    verbose=False,
                    logger=None,
                )

            self.logger.info(
                f"Preprocessed video for Gemini: {video_path} -> {tmp_path} "
                f"(fps={out_fps if out_fps else 'orig'}, size={new_w}x{new_h}, audio=preserved, gpu={'yes' if tried_gpu else 'no'})"
            )

            # Optionally persist a copy under project_root/temp for inspection
            save_flag = (os.getenv("SAVE_TEMP") or "").strip().lower() == "true"
            if save_flag:
                project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
                out_dir = os.path.join(project_root, "temp")
                os.makedirs(out_dir, exist_ok=True)
                base = os.path.splitext(os.path.basename(video_path))[0]
                dest_path = os.path.join(out_dir, f"{base}_preprocessed.mp4")
                try:
                    shutil.copy2(tmp_path, dest_path)
                    self.logger.info(f"Saved preprocessed video copy to: {dest_path}")
                except Exception as e:
                    self.logger.warning(f"Failed to save preprocessed copy to '{dest_path}': {e}")

            return tmp_path
        except Exception as e:
            self.logger.warning(f"MoviePy preprocessing failed; using original. Error: {e}")
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            return None
        finally:
            try:
                if resized_clip and resized_clip is not clip:
                    resized_clip.close()
            except Exception:
                pass
            try:
                if clip:
                    clip.close()
            except Exception:
                pass


    def _process_static_image(self, image_path: str) -> Dict:
        """
        Processes a single static image file into the Base64 format 
        required for OpenAI's 'image_url' content type.
        """
        self.logger.debug(f"Processing static image for OpenAI: {image_path}")
        if not os.path.exists(image_path):
            self.logger.error(f"Image file not found at: {image_path}")
            raise FileNotFoundError(f"Image file not found at: {image_path}")

        try:
            # Requires PIL (Image) and io to be imported
            img = Image.open(image_path)
            # Convert to RGB to ensure compatibility
            if img.mode not in ('RGB', 'L', 'P'): # Keep simple modes, convert others
                img = img.convert('RGB')
            
            # Save the image to a bytes buffer as JPEG for Base64 encoding
            buffered = io.BytesIO()
            img.save(buffered, format="JPEG")
            
            # Encode the bytes to Base64
            base64_image = base64.b64encode(buffered.getvalue()).decode("utf-8")
            
            self.logger.info(f"Successfully converted static image: {image_path}")
            
            # Return the content dict structure for OpenAI
            return {
                "type": "image_url", 
                "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
            }
        except Exception as e:
            self.logger.error(f"Failed to process static image: {e}")
            raise

    def _validate_pdf_path(self, pdf_path: str):
        """Validates a local PDF path."""
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found at: {pdf_path}")
        if not pdf_path.lower().endswith(".pdf"):
            raise ValueError(f"Expected a .pdf file, got: {pdf_path}")

    def _infer_attachment_kind(self, path: str) -> str:
        ext = os.path.splitext(path)[1].lower()
        if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
            return "image"
        if ext == ".pdf":
            return "pdf"
        if ext in {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}:
            return "video"
        return "file"

    def _normalize_attachments(
        self,
        attachments: Optional[List[Any]],
        allow_missing: bool = False,
    ) -> List[Dict[str, str]]:
        normalized: List[Dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        if not attachments:
            return normalized

        for item in attachments:
            path: Optional[str] = None
            kind: Optional[str] = None

            if isinstance(item, str):
                path = item
            elif isinstance(item, dict):
                raw_path = item.get("path") or item.get("file") or item.get("filepath")
                if isinstance(raw_path, str):
                    path = raw_path
                raw_kind = item.get("kind") or item.get("type")
                if isinstance(raw_kind, str):
                    kind = raw_kind.strip().lower()
            else:
                continue

            if not path:
                continue

            abs_path = os.path.abspath(path)
            if not os.path.exists(abs_path):
                if allow_missing:
                    self.logger.warning(f"Skipping missing attachment in history: {abs_path}")
                    continue
                raise FileNotFoundError(f"Attachment file not found: {abs_path}")

            resolved_kind = kind or self._infer_attachment_kind(abs_path)
            dedup_key = (abs_path, resolved_kind)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            normalized.append({"path": abs_path, "kind": resolved_kind})

        return normalized

    def _merge_attachments(self, *groups: Optional[List[Dict[str, str]]]) -> List[Dict[str, str]]:
        merged: List[Dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for group in groups:
            if not group:
                continue
            for att in group:
                path = att.get("path")
                kind = att.get("kind", "file")
                if not path:
                    continue
                key = (path, kind)
                if key in seen:
                    continue
                seen.add(key)
                merged.append({"path": path, "kind": kind})
        return merged

    def clear_history(self):
        """Clears the internal conversation history."""
        self.history = []
        self.logger.info("Conversation history cleared.") # <-- ADDED
        print("--- History Cleared ---") # <-- Kept this user-facing print

    def _get_trimmed_history(self) -> List[Dict[str, Any]]:
        """Returns history clipped to max_history_messages, if configured."""
        if self.max_history_messages is None:
            return self.history
        return self.history[-self.max_history_messages:]

    def _enforce_history_limit(self):
        """Applies max_history_messages to stored history, if configured."""
        if self.max_history_messages is None:
            return
        if len(self.history) > self.max_history_messages:
            self.history = self.history[-self.max_history_messages:]

    def generate(self, 
                 prompt: str,
                 image_path: Optional[str] = None,
                 video_path: Optional[str] = None,
                 pdf_path: Optional[str] = None,
                 attachments: Optional[List[Any]] = None,
                 return_json: Optional[bool] = None,
                 keep_history: bool = False,
                 video_sample_fps: float = 1.0) -> Any: # <-- ADDED FPS PARAM
        """
        Generates a response from the model, with optional video input.

        Args:
            prompt (str): The user's text prompt.
            image_path (Optional[str]): Path to a static image file.
            video_path (Optional[str]): Path to a local video file.
            pdf_path (Optional[str]): Path to a local PDF file.
            attachments (Optional[List[Any]]): Extra per-turn attachments. Each item
                can be a local file path string or dict like
                {"path": "...", "kind": "image|pdf|video|file"}.
            return_json (Optional[bool]): Overrides class default for returning JSON.
            keep_history (bool): Whether to use and update conversation history.
            video_sample_fps (float): Frames-per-second to sample for OpenAI.

        Returns:
            Any: The model's response (str or dict/list).
        """
        self.logger.info(f"Generate called with model: {self.model_name}")
        if image_path:
            self.logger.info(f"  ... with image: {image_path}")
        if video_path:
            self.logger.info(f"  ... with video: {video_path}")
        if pdf_path:
            self.logger.info(f"  ... with pdf: {pdf_path}")
        if attachments:
            self.logger.info(f"  ... with attachments: {len(attachments)} item(s)")
            
        should_return_json = self.return_json if return_json is None else return_json
        self.logger.debug(f"  ... return_json={should_return_json}, keep_history={keep_history}")

        normalized_current_attachments = self._normalize_attachments(attachments)
        inline_attachments: List[Any] = []
        if image_path:
            inline_attachments.append(image_path)
        if video_path:
            inline_attachments.append(video_path)
        if pdf_path:
            inline_attachments.append(pdf_path)
        normalized_current_attachments = self._merge_attachments(
            normalized_current_attachments,
            self._normalize_attachments(inline_attachments),
        )

        # Explicitly forbid video input for the OpenAI path in this wrapper.
        if video_path and self.api_type == "openai":
            self.logger.error(
                "OpenAI API wrapper does not support video input; use Google Gemini for video."
            )
            raise ValueError(
                "OpenAI does not support video input in this wrapper. "
                "Please use a Google Gemini model for video processing."
            )
        if self.api_type == "openai" and any(att.get("kind") == "video" for att in normalized_current_attachments):
            self.logger.error("OpenAI path does not support video attachments in this wrapper.")
            raise ValueError(
                "OpenAI does not support video attachments in this wrapper. "
                "Please use a Google Gemini model for video processing."
            )
        
        if self.api_type == "openai":
            # Pass the new FPS parameter
            return self._generate_openai(
                prompt,
                image_path=image_path,
                pdf_path=pdf_path,
                current_attachments=normalized_current_attachments,
                return_json=should_return_json,
                keep_history=keep_history,
                video_sample_fps=video_sample_fps,
            )
        elif self.api_type == "google":
            return self._generate_google(
                prompt,
                image_path=image_path,
                video_path=video_path,
                pdf_path=pdf_path,
                current_attachments=normalized_current_attachments,
                return_json=should_return_json,
                keep_history=keep_history,
            )
        else:
            self.logger.error("API type not properly initialized.")
            raise RuntimeError("API type not properly initialized.")

    def _generate_openai(
        self,
        prompt: str,
        image_path: Optional[str],
        pdf_path: Optional[str],
        current_attachments: List[Dict[str, str]],
        return_json: bool,
        keep_history: bool,
        video_sample_fps: float,
    ) -> Any:
        history_to_send = self._get_trimmed_history() if keep_history else []
        final_prompt = prompt
        if return_json and "json" not in final_prompt.lower():
            final_prompt += "\n\nYou must return a valid JSON object."

        history_has_attachments = any(bool(msg.get("attachments")) for msg in history_to_send if isinstance(msg, dict))
        only_inline_image = False
        if image_path and current_attachments:
            abs_image = os.path.abspath(image_path)
            only_inline_image = (
                len(current_attachments) == 1
                and current_attachments[0].get("kind") == "image"
                and current_attachments[0].get("path") == abs_image
            )
        use_responses_api = bool(
            self.system_attachments or
            (current_attachments and not only_inline_image) or
            history_has_attachments or
            pdf_path
        )
        uploaded_file_ids: List[str] = []

        def _upload_openai_attachments(att_list: List[Dict[str, str]]) -> List[Dict[str, Any]]:
            parts: List[Dict[str, Any]] = []
            for att in att_list:
                with open(att["path"], "rb") as file_obj:
                    uploaded = self._client.files.create(file=file_obj, purpose="user_data")
                uploaded_file_ids.append(uploaded.id)
                parts.append({"type": "input_file", "file_id": uploaded.id})
            return parts

        try:
            if use_responses_api:
                input_messages: List[Dict[str, Any]] = []

                system_parts: List[Dict[str, Any]] = []
                if self.system_content:
                    system_parts.append({"type": "input_text", "text": self.system_content})
                system_parts.extend(_upload_openai_attachments(self.system_attachments))
                if system_parts:
                    input_messages.append({"role": "system", "content": system_parts})

                for msg in history_to_send:
                    mapped_role = "assistant" if msg.get("role") == "model" else msg.get("role", "user")
                    msg_parts: List[Dict[str, Any]] = []
                    msg_text = str(msg.get("content", "") or "")
                    if msg_text:
                        msg_parts.append({"type": "input_text", "text": msg_text})
                    hist_att = self._normalize_attachments(msg.get("attachments"), allow_missing=True)
                    msg_parts.extend(_upload_openai_attachments(hist_att))
                    if msg_parts:
                        input_messages.append({"role": mapped_role, "content": msg_parts})

                input_parts: List[Dict[str, Any]] = [{"type": "input_text", "text": final_prompt}]
                input_parts.extend(_upload_openai_attachments(current_attachments))
                input_messages.append({"role": "user", "content": input_parts})

                response_kwargs: Dict[str, Any] = {
                    "model": self.model_name,
                    "input": input_messages,
                }
                if return_json:
                    response_kwargs["text"] = {"format": {"type": "json_object"}}
                gpt_max_tokens = os.getenv("GPT_MAX_TOKENS")
                if gpt_max_tokens:
                    response_kwargs["max_output_tokens"] = int(gpt_max_tokens)

                self.logger.debug("Sending request to OpenAI Responses API...")
                response = self._client.responses.create(**response_kwargs)
                response_content = getattr(response, "output_text", None)
                if not response_content:
                    response_content = str(response)
            else:
                messages: List[Dict[str, Any]] = []
                if self.system_content:
                    messages.append({"role": "system", "content": self.system_content})
                for msg in history_to_send:
                    messages.append({
                        "role": "assistant" if msg.get("role") == "model" else msg.get("role", "user"),
                        "content": msg.get("content", ""),
                    })

                user_content: List[Dict[str, Any]] = [{"type": "text", "text": final_prompt}]
                if image_path:
                    self.logger.info(f"Processing static image: {image_path}")
                    try:
                        user_content.append(self._process_static_image(image_path))
                    except Exception as e:
                        self.logger.error(f"Error processing static image: {e}")
                        return None
                messages.append({"role": "user", "content": user_content})

                request_params: Dict[str, Any] = {
                    "model": self.model_name,
                    "messages": messages,
                    "max_completion_tokens": int(os.getenv("GPT_MAX_TOKENS")),
                }
                if return_json:
                    request_params["response_format"] = {"type": "json_object"}

                self.logger.debug("Sending request to OpenAI Chat Completions API...")
                response = self._client.chat.completions.create(**request_params)
                response_content = response.choices[0].message.content

            self.logger.debug(f"Received response from OpenAI:{response_content}")

            if keep_history and response_content:
                self.history.append({
                    "role": "user",
                    "content": prompt,
                    "attachments": current_attachments,
                })
                self.history.append({"role": "model", "content": response_content})
                self._enforce_history_limit()

            if return_json and response_content:
                try:
                    self.logger.debug("Cleaning JSON response...")
                    cleaned_content = self._clean_json(response_content)
                    return json.loads(cleaned_content)
                except json.JSONDecodeError:
                    self.logger.warning(f"OpenAI response was not valid JSON after cleaning: {response_content}")
                    return response_content
            return response_content

        except Exception as e:
            self.logger.error(f"Error calling OpenAI: {e}")
            return None
        finally:
            for file_id in uploaded_file_ids:
                try:
                    self._client.files.delete(file_id)
                except Exception:
                    pass

    def _generate_google(
        self,
        prompt: str,
        image_path: Optional[str],
        video_path: Optional[str],
        pdf_path: Optional[str],
        current_attachments: List[Dict[str, str]],
        return_json: bool,
        keep_history: bool,
    ) -> Any:
        contents: List[Any] = []
        uploaded_files: List[Any] = []
        temp_local_paths: List[str] = []

        def _upload_google_attachment(att: Dict[str, str]) -> Any:
            upload_path = att["path"]
            if att.get("kind") == "video":
                preprocessed = self._preprocess_video_for_gemini(upload_path)
                if preprocessed:
                    upload_path = preprocessed
                    temp_local_paths.append(preprocessed)

            file_ref = self._client.files.upload(file=upload_path)
            state_name = getattr(getattr(file_ref, "state", None), "name", None) or getattr(file_ref, "state", None)
            while state_name != "ACTIVE":
                time.sleep(2)
                file_ref = self._client.files.get(name=file_ref.name)
                state_name = getattr(getattr(file_ref, "state", None), "name", None) or getattr(file_ref, "state", None)
                if state_name == "FAILED":
                    raise Exception(f"File processing failed for {att['path']}: {state_name}")
            uploaded_files.append(file_ref)
            return file_ref

        try:
            if self.system_content:
                try:
                    contents.append(types.Content(role="system", parts=[self.system_content]))
                except Exception:
                    contents.append(self.system_content)

            for att in self.system_attachments:
                contents.append(_upload_google_attachment(att))

            history_to_send = self._get_trimmed_history() if keep_history else []
            for msg in history_to_send:
                role = msg.get("role", "user")
                if role == "assistant":
                    role = "model"
                try:
                    contents.append(types.Content(role=role, parts=[msg.get("content", "")]))
                except Exception:
                    contents.append(msg.get("content", ""))

                hist_att = self._normalize_attachments(msg.get("attachments"), allow_missing=True)
                for att in hist_att:
                    contents.append(_upload_google_attachment(att))

            try:
                contents.append(types.Content(role="user", parts=[types.Part(text=prompt)]))
            except Exception:
                contents.append(prompt)

            for att in current_attachments:
                contents.append(_upload_google_attachment(att))

            generation_config = None
            if return_json:
                try:
                    generation_config = types.GenerateContentConfig(response_mime_type="application/json")
                except Exception:
                    generation_config = {"response_mime_type": "application/json"}

            self.logger.debug("Sending request to Google Gemini API (Client models.generate_content)...")
            response = self._client.models.generate_content(
                model=self.model_name,
                contents=contents,
                config=generation_config,
            )
            response_content = getattr(response, "text", None)
            if response_content is None and hasattr(response, "candidates"):
                try:
                    response_content = response.candidates[0].content.parts[0].text
                except Exception:
                    response_content = None

            if keep_history and response_content:
                self.history.append({
                    "role": "user",
                    "content": prompt,
                    "attachments": current_attachments,
                })
                self.history.append({"role": "model", "content": response_content})
                self._enforce_history_limit()

            if return_json and response_content:
                try:
                    cleaned_content = self._clean_json(response_content)
                    return json.loads(cleaned_content)
                except json.JSONDecodeError:
                    self.logger.warning(f"Gemini response was not valid JSON after cleaning: {response_content}")
                    return response_content
            return response_content

        except Exception as e:
            self.logger.error(f"Error calling Google Gemini: {e}")
            return None
        finally:
            try:
                for file_ref in uploaded_files:
                    state_name = getattr(getattr(file_ref, "state", None), "name", None) or getattr(file_ref, "state", None)
                    if state_name == "ACTIVE":
                        self._client.files.delete(name=file_ref.name)
            except Exception:
                pass
            for local_path in temp_local_paths:
                try:
                    if os.path.exists(local_path):
                        os.remove(local_path)
                except Exception:
                    pass

# --- Example/Test Harness ---
# (Logger is used inside LLM_Model; this block focuses on exercising functionality.)
if __name__ == "__main__":
    def banner(title: str):
        print("\n" + "=" * 20 + f" {title} " + "=" * 20)

    
    sample_video_file = "data/sample.mp4"
    if not os.path.exists(sample_video_file):
    # if the video file does not exist then, 
    # Best-effort creation of a tiny sample video to enable video tests
        try:
            import numpy as np
            if cv2 is not None:
                width, height, fps, frames = 64, 64, 5, 20
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(sample_video_file, fourcc, fps, (width, height))
                for i in range(frames):
                    img = np.zeros((height, width, 3), dtype=np.uint8)
                    cv2.putText(img, f"F{i}", (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                    color = (i * 10 % 255, (i * 5) % 255, (i * 3) % 255)
                    cv2.rectangle(img, (i % width, i % height), (width - 1, height - 1), color, 2)
                    writer.write(img)
                writer.release()
        except Exception:
            # If creation fails, we'll just skip video tests later
            pass

    has_openai_key = bool(os.environ.get("OPENAI_API_KEY"))
    has_gemini_key = bool(os.environ.get("GOOGLE_API_KEY"))

    if not (has_openai_key or has_gemini_key):
        banner("SETUP WARNING")
        print("API keys not found. Set OPENAI_API_KEY and/or GOOGLE_API_KEY to run tests.")
    
    # Collect test results for quick visibility
    results: Dict[str, Any] = {}

    # ---- Text-only: Gemini (standard + JSON) ----
    if has_gemini_key:
        try:
            banner("Gemini Text: standard output")
            gemini_text = LLM_Model(
                "gemini-3-flash-preview",
                system_content="You are a helpful assistant. Keep replies concise.",
                return_json=False,
            )
            res = gemini_text.generate("Say hi in one short sentence.")
            results["gemini_text_standard"] = res
            print(str(res)[:500])

            banner("Gemini Text: JSON output")
            gemini_json = LLM_Model(
                "gemini-3-flash-preview",
                system_content="Return structured data when asked.",
                return_json=True,
            )
            res_json = gemini_json.generate(
                "Return a JSON object with keys: greeting (string) and lang (string).",
                return_json=True,
                keep_history=False,
            )
            results["gemini_text_json"] = res_json
            print(str(res_json)[:500])
        except Exception as e:
            print(f"Gemini text tests failed: {e}")

        # ---- History + clear_history test (Gemini) ----
        try:
            banner("Gemini: history + clear")
            gem_hist = LLM_Model("gemini-3-flash-preview", system_content="Be brief.")
            a1 = gem_hist.generate("What is the capital of France?", keep_history=True)
            a2 = gem_hist.generate("Name a color on that country's flag.", keep_history=True)
            print("Turn 1:", str(a1)[:200])
            print("Turn 2:", str(a2)[:200])
            print("History length before clear:", len(gem_hist.history))
            gem_hist.clear_history()
            print("History length after clear:", len(gem_hist.history))
            results["gemini_history_len_after_clear"] = len(gem_hist.history)
        except Exception as e:
            print(f"Gemini history tests failed: {e}")

    # ---- Text-only: OpenAI (standard + JSON) ----
    if has_openai_key:
        try:
            banner("OpenAI Text: standard output")
            oa_text = LLM_Model("gpt-5", system_content="Be concise.", return_json=False)
            res = oa_text.generate("Give me a random fun fact in one sentence.")
            results["openai_text_standard"] = res
            print(str(res)[:500])

            banner("OpenAI Text: JSON output")
            oa_json = LLM_Model("gpt-5", system_content="Return JSON when asked.", return_json=True)
            res_json = oa_json.generate(
                "Return a JSON object: {\"animal\": string, \"legs\": number}.",
                return_json=True,
            )
            results["openai_text_json"] = res_json
            print(str(res_json)[:500])
        except Exception as e:
            print(f"OpenAI text tests failed: {e}")

    # ---- Image + Video: Gemini + OpenAI ----
    sample_image_file = "data/samples/sample.png"
    sample_pdf_file = "data/samples/sample.pdf"

    if has_gemini_key and os.path.exists(sample_image_file):
        try:
            banner("Gemini: image + text")
            gem_image = LLM_Model(
                "gemini-3-flash-preview",
                system_content="If an image is present, briefly describe what you see.",
            )
            r_img = gem_image.generate(
                "Describe the image in one sentence.",
                image_path=sample_image_file,
            )
            results["gemini_image"] = r_img
            print(str(r_img)[:500])
        except Exception as e:
            print(f"Gemini image test failed: {e}")

    if has_openai_key and os.path.exists(sample_image_file):
        try:
            banner("OpenAI: image + text")
            oa_image = LLM_Model(
                "gpt-5",
                system_content="If an image is present, briefly describe what you see.",
            )
            r_img = oa_image.generate(
                "Describe the image in one sentence.",
                image_path=sample_image_file,
            )
            results["openai_image"] = r_img
            print(str(r_img)[:500])
        except Exception as e:
            print(f"OpenAI image test failed: {e}")

    # ---- PDF: Gemini + OpenAI ----
    if has_gemini_key and os.path.exists(sample_pdf_file):
        try:
            banner("Gemini: PDF + text")
            gem_pdf = LLM_Model(
                "gemini-3-flash-preview",
                system_content="If a PDF is present, summarize it briefly.",
            )
            r_pdf = gem_pdf.generate(
                "Summarize this PDF in 3 bullet points.",
                pdf_path=sample_pdf_file,
            )
            results["gemini_pdf"] = r_pdf
            print(str(r_pdf)[:500])
        except Exception as e:
            print(f"Gemini PDF test failed: {e}")

    if has_openai_key and os.path.exists(sample_pdf_file):
        try:
            banner("OpenAI: PDF + text")
            oa_pdf = LLM_Model(
                "gpt-5",
                system_content="If a PDF is present, summarize it briefly.",
            )
            r_pdf = oa_pdf.generate(
                "Summarize this PDF in 3 bullet points.",
                pdf_path=sample_pdf_file,
            )
            results["openai_pdf"] = r_pdf
            print(str(r_pdf)[:500])
        except Exception as e:
            print(f"OpenAI PDF test failed: {e}")

    # ---- Video: Gemini + OpenAI ----
    if os.path.exists(sample_video_file):
        # Gemini video
        if has_gemini_key:
            try:
                banner("Gemini: video + text")
                gem_video = LLM_Model(
                    "gemini-3-flash-preview",
                    system_content="If video present, briefly describe what you see.",
                )
                r = gem_video.generate("Describe the video in one sentence.", video_path=sample_video_file)
                results["gemini_video"] = r
                print(str(r)[:500])
            except Exception as e:
                print(f"Gemini video test failed: {e}")

        # OpenAI video
        if has_openai_key:
            try:
                banner("OpenAI: video + text")
                oa_video = LLM_Model(
                    "gpt-5",
                    system_content="Summarize the provided visual content succinctly.",
                )
                r = oa_video.generate(
                    "Summarize the video.",
                    video_path=sample_video_file,
                    video_sample_fps=2.0,
                )
                results["openai_video"] = r
                print(str(r)[:500])
            except Exception as e:
                print(f"OpenAI video test failed: {e}")
    else:
        banner("Video Skipped")
        print(f"No video at '{sample_video_file}'. Skipping video tests.")

    banner("DONE")
    # Light summary keys only (avoid dumping large responses)
    print("Completed test groups:", ", ".join(sorted(results.keys())))
