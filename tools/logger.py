import logging
import os
from dotenv import load_dotenv

# Ensure environment variables are loaded
load_dotenv()

class Logger:
    """
    A simple Logger wrapper to resolve the missing logger dependency 
    for llm_model.py and tts.py.
    """
    def __init__(self, name: str = "EduShorts"):
        self.logger = logging.getLogger(name)
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter("[%(levelname)s] %(asctime)s - %(message)s", datefmt="%H:%M:%S")
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
            
            # Use log level from env or default to INFO, stripping quotes/spaces
            log_level = os.getenv("LOG_LEVEL", "INFO").strip('"\'').strip().upper()
            numeric_level = getattr(logging, log_level, logging.INFO)
            self.logger.setLevel(numeric_level)

    def debug(self, message: str):
        self.logger.debug(message)

    def info(self, message: str):
        self.logger.info(message)

    def warning(self, message: str):
        self.logger.warning(message)

    def error(self, message: str):
        self.logger.error(message)

    def critical(self, message: str):
        self.logger.critical(message)
