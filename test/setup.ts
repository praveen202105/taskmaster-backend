process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://taskmaster:taskmaster@localhost:5432/taskmaster_test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-that-is-at-least-thirty-two-characters";
process.env.UPLOAD_DIR ??= "./tmp/test-uploads";
process.env.LOG_LEVEL ??= "silent";
