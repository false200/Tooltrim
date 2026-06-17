declare module "micromatch" {
  function micromatch(
    patterns: string | string[],
    options?: Record<string, unknown>,
  ): (str: string) => boolean;

  namespace micromatch {
    function matcher(
      patterns: string | string[],
      options?: Record<string, unknown>,
    ): (str: string) => boolean;
  }

  export = micromatch;
}
