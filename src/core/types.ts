export type EnglishDialect = 'american' | 'british' | 'australian' | 'canadian';

export type TextRange = Readonly<{
  start: number;
  end: number;
}>;

export type EditorSnapshot = Readonly<{
  revision: number;
  text: string;
}>;

export type IssueCategory =
  | 'spelling'
  | 'grammar'
  | 'punctuation'
  | 'capitalization'
  | 'style';

export type WritingIssue = Readonly<{
  id: string;
  source: 'core' | 'typecheck';
  ruleId: string;
  range: TextRange;
  category: IssueCategory;
  message: string;
  replacements: readonly string[];
  /** Text captured at the exact source range when the issue was detected. */
  originalText: string;
  /** A local heuristic may expose a calibrated confidence when available. */
  confidence?: number;
  issueHash: string;
}>;

export type ApplyResult = Readonly<{
  applied: boolean;
  revision: number;
}>;

export interface EditorAdapter {
  readonly id: string;
  readonly element: HTMLElement;
  capture(revision: number): EditorSnapshot;
  /** The boxes of each range's text on screen, measured together so the page is laid out only once. */
  rangesToRects(ranges: readonly TextRange[]): readonly (readonly DOMRect[])[];
  applySuggestion(range: TextRange, replacement: string, revision: number): Promise<ApplyResult>;
}
