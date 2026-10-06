/** Thrown for errors a retry cannot fix (bad data, missing config); the job fails at once. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
