declare module 'ollama' {
  const ollama: any;
  export default ollama;
}

declare module 'openai' {
  const OpenAI: any;
  export default OpenAI;
}

declare module '@anthropic-ai/sdk' {
  const Anthropic: any;
  export default Anthropic;
}

declare module '@google/generative-ai' {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: { model: string }): {
      generateContent(prompt: string): Promise<{
        response: {
          text(): string;
        };
      }>;
    };
  }
}
