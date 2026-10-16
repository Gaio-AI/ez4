/**
 * Supported LLM providers for agent execution.
 */
export const enum AgentProvider {
  /**
   * Claude agent provider.
   */
  Claude = 'claude'
}

/**
 * Standard Claude model aliases.
 */
export const enum ClaudeModel {
  /**
   * Claude Opus model.
   */
  Opus = 'opus',

  /**
   * Claude Sonnet model.
   */
  Sonnet = 'sonnet',

  /**
   * Claude Haiku model.
   */
  Haiku = 'haiku'
}

/**
 * Standard Claude tool names.
 */
export const enum ClaudeTool {
  /**
   * File read tool.
   */
  Read = 'Read',

  /**
   * Content search tool.
   */
  Grep = 'Grep',

  /**
   * File search tool.
   */
  Glob = 'Glob',

  /**
   * File edit tool.
   */
  Edit = 'Edit',

  /**
   * File write tool.
   */
  Write = 'Write',

  /**
   * Command execution tool.
   */
  Bash = 'Bash',

  /**
   * Web fetch tool.
   */
  WebFetch = 'WebFetch',

  /**
   * Web search tool.
   */
  WebSearch = 'WebSearch'
}
