// The child uses production services without launching Electron or writing user data.
export const app = {
  getPath: (): string => {
    const path = process.env.CRASH_TEST_USER_DATA
    if (!path) throw new Error('Missing isolated crash-test user data directory')
    return path
  }
}

export default {
  transports: { file: { level: 'info', maxSize: 0 }, console: { level: 'debug' } },
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  debug: (): void => {}
}
