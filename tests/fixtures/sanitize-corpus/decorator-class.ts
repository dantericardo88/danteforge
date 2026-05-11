// Fixture: a class with decorators — Tier 1 (AST mover) must REFUSE.
// This proves the refusal path works correctly when LLM fallback would be needed.

function Decorator(): ClassDecorator {
  return () => {};
}

export interface Config { setting: string; }

@Decorator()
export class DecoratedService {
  constructor(private cfg: Config) {}

  process(x: string): string {
    return `${this.cfg.setting}:${x}`;
  }
}
