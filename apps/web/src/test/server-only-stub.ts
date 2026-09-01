/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * The real package exists to make a build fail when server code is imported
 * into a client bundle. That guard is a build-time concern; under test it would
 * simply block importing the modules we want to exercise.
 */
export {};
