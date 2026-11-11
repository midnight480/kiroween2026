/** 行・桁つきのコンパイルエラー（設計書 §7 / §9.1）。 */
export class CobolError extends Error {
  readonly code: string;
  readonly line: number;
  readonly col: number;

  constructor(code: string, message: string, line: number, col: number) {
    super(message);
    this.name = "CobolError";
    this.code = code;
    this.line = line;
    this.col = col;
  }
}

export interface Diagnostic {
  code: string;
  message: string;
  line?: number;
}
