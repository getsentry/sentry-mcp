declare module "better-sqlite3" {
  export type DatabaseOptions = {
    readonly?: boolean;
    fileMustExist?: boolean;
  };

  export type Statement<Result = Record<string, unknown>> = {
    get(...params: unknown[]): Result | undefined;
    run(...params: unknown[]): unknown;
  };

  export default class Database {
    constructor(filename: string, options?: DatabaseOptions);
    prepare<Result = Record<string, unknown>>(
      source: string,
    ): Statement<Result>;
    exec(source: string): this;
    close(): this;
  }
}
