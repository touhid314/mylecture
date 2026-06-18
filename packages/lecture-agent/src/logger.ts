import dotenv from 'dotenv';
dotenv.config();

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARNING = 2,
    ERROR = 3,
    CRITICAL = 4
}

export class Logger {
    private logLevel: LogLevel = LogLevel.INFO;

    constructor(name: string = "EduShorts") {
        const envLogLevel = (process.env.LOG_LEVEL || "INFO").replace(/['"]/g, "").trim().toUpperCase();
        switch (envLogLevel) {
            case "DEBUG":
                this.logLevel = LogLevel.DEBUG;
                break;
            case "INFO":
                this.logLevel = LogLevel.INFO;
                break;
            case "WARNING":
            case "WARN":
                this.logLevel = LogLevel.WARNING;
                break;
            case "ERROR":
                this.logLevel = LogLevel.ERROR;
                break;
            case "CRITICAL":
                this.logLevel = LogLevel.CRITICAL;
                break;
            default:
                this.logLevel = LogLevel.INFO;
        }
    }

    private formatMessage(level: string, message: string): string {
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
        return `[${level}] ${timeStr} - ${message}`;
    }

    debug(message: string): void {
        if (this.logLevel <= LogLevel.DEBUG) {
            console.log(this.formatMessage("DEBUG", message));
        }
    }

    info(message: string): void {
        if (this.logLevel <= LogLevel.INFO) {
            console.log(this.formatMessage("INFO", message));
        }
    }

    warning(message: string): void {
        if (this.logLevel <= LogLevel.WARNING) {
            console.warn(this.formatMessage("WARNING", message));
        }
    }

    error(message: string): void {
        if (this.logLevel <= LogLevel.ERROR) {
            console.error(this.formatMessage("ERROR", message));
        }
    }

    critical(message: string): void {
        if (this.logLevel <= LogLevel.CRITICAL) {
            console.error(this.formatMessage("CRITICAL", message));
        }
    }
}
