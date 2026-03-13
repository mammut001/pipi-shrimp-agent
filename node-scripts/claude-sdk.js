/**
 * Claude SDK Bridge
 *
 * 通过标准输入接收 JSON 请求
 * 调用 Claude/Minimax 等 API
 * 通过标准输出返回 JSON 响应
 * 支持工具调用 (Function Calling)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * 工具定义 - 用于 Function Calling
 * 这些工具会被传递给 AI，让 AI 可以调用来操作电脑
 */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the filesystem. Use this when you need to see what is inside a file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the file to read'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Use this to create new files or overwrite existing ones.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the file to write'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Execute a bash command in the terminal. Use this to run shell commands, git operations, npm commands, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute'
          },
          cwd: {
            type: 'string',
            description: 'The working directory for the command (optional)'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory. Use this to explore the file structure.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path to list'
          },
          pattern: {
            type: 'string',
            description: 'Optional glob pattern to filter files (e.g., "*.ts", "src/**")'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a new directory (and parent directories if needed).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path to create'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'path_exists',
      description: 'Check if a file or directory exists.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to check'
          }
        },
        required: ['path']
      }
    }
  }
];

/**
 * 写入工具调用事件 - 通知 Rust 后端需要执行工具
 */
function writeToolUseEvent(toolCall) {
  console.log(JSON.stringify({
    type: 'tool_use',
    tool_call_id: toolCall.id,
    name: toolCall.function.name,
    arguments: toolCall.function.arguments
  }));
}

/**
 * 工具调用完成事件 - 工具执行完后发送结果给 AI
 */
function writeToolResultEvent(toolCallId, result) {
  console.log(JSON.stringify({
    type: 'tool_result',
    tool_call_id: toolCallId,
    result: result
  }));
}

/**
 * 从标准输入读取 JSON 字符串
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');

    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      try {
        const json = JSON.parse(data);
        resolve(json);
      } catch (error) {
        reject(new Error(`Failed to parse JSON: ${error.message}`));
      }
    });

    process.stdin.on('error', reject);
  });
}

/**
 * 向标准输出写入 JSON 字符串 (for non-streaming responses)
 */
function writeStdout(data) {
  console.log(JSON.stringify(data));
}

/**
 * 向标准输出写入流式 chunk (每个 token 一行)
 * 格式: { type: 'chunk', content: 'token text' }
 */
function writeStreamChunk(content) {
  console.log(JSON.stringify({ type: 'chunk', content }));
}

/**
 * 向标准输出写入流式结束信号
 */
function writeStreamEnd(data) {
  console.log(JSON.stringify({ type: 'done', ...data }));
}

/**
 * 从文本中检测 Artifacts (代码块、HTML等)
 */
function detectArtifacts(content) {
  const artifacts = [];

  // 检测代码块
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1] || 'plaintext';
    const code = match[2];

    // 长代码块作为 artifact
    if (code.length > 200) {
      artifacts.push({
        type: 'code',
        language,
        content: code,
        title: `${language} code`
      });
    }
  }

  // 检测 HTML
  if (content.includes('<!DOCTYPE') || content.includes('<html')) {
    const htmlMatch = content.match(/<html[\s\S]*<\/html>/);
    if (htmlMatch) {
      artifacts.push({
        type: 'html',
        content: htmlMatch[0],
        title: 'HTML Document'
      });
    }
  }

  // 检测 Mermaid 图表
  const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
  while ((match = mermaidRegex.exec(content)) !== null) {
    artifacts.push({
      type: 'mermaid',
      content: match[1],
      title: 'Diagram'
    });
  }

  return artifacts;
}

/**
 * 格式化消息列表 (OpenAI/Minimax 格式)
 */
function formatMessagesForOpenAI(messages) {
  const formatted = [];
  
  for (const msg of messages) {
    if (msg.role === 'user' && msg.content.startsWith('__TOOL_RESULT__:')) {
      const parts = msg.content.split(':');
      const toolCallId = parts[1];
      const content = parts.slice(2).join(':');
      
      formatted.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: content
      });
      continue;
    }
    
    formatted.push({
      role: msg.role,
      content: msg.content
    });
  }
  
  return formatted;
}

/**
 * 调用自定义 API (Minimax, OpenAI 兼容格式) - 支持流式和工具调用
 */
async function callCustomAPI(request, isStreaming = false) {
  const { apiKey, baseURL, model, messages, systemPrompt, maxTokens, tools } = request;

  const msgs = formatMessagesForOpenAI(messages);

  // 检查是否是推理模型（如 deepseek-reasoner），这些模型通常不支持工具调用
  const isReasoningModel = model.toLowerCase().includes('reasoner') || model.toLowerCase().includes('r1');
  const validTools = isReasoningModel ? undefined : tools;

  // 构建请求
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: msgs,
      ...(systemPrompt && { system: systemPrompt }), // Note: Some OpenAI compatible endpoints might expect this in messages, but we send null currently
      ...(validTools && validTools.length > 0 && { tools: validTools }),
      max_tokens: maxTokens || 2048,
      stream: isStreaming
    })
  };

  // 调用 API
  const response = await fetch(`${baseURL}/chat/completions`, fetchOptions);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
  }

  // 流式处理
  if (isStreaming && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 处理 SSE 格式的行
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            let dataStr = '';
            if (trimmed.startsWith('data: ')) {
              dataStr = trimmed.slice(6).trim();
            } else {
              dataStr = trimmed.slice(5).trim();
            }
            
            if (!dataStr) continue;

            if (dataStr === '[DONE]') {
              // 流结束
              const usage = { input_tokens: 0, output_tokens: fullContent.length };
              writeStreamEnd({ content: fullContent, model, usage });
              return;
            }

            try {
              const data = JSON.parse(dataStr);
              // Handle standard content delta
              const delta = data.choices?.[0]?.delta?.content || '';
              // Handle DeepSeek reasoning_content
              const reasoningDelta = data.choices?.[0]?.delta?.reasoning_content || '';
              
              const finishReason = data.choices?.[0]?.finish_reason;

              // 检测工具调用
              if (finishReason === 'tool_calls') {
                const toolCalls = data.choices?.[0]?.delta?.tool_calls || [];
                for (const toolCall of toolCalls) {
                  writeToolUseEvent({
                    id: toolCall.id || `tool_${Date.now()}`,
                    function: {
                      name: toolCall.function?.name || '',
                      arguments: toolCall.function?.arguments || ''
                    }
                  });
                }
                // 发送结束信号，标记为工具调用
                writeStreamEnd({
                  content: fullContent,
                  model,
                  usage: { input_tokens: 0, output_tokens: fullContent.length },
                  finishReason: 'tool_calls'
                });
                return;
              }

              // Append whatever content we got (reasoning or actual content)
              const contentToEmit = reasoningDelta || delta || '';
              if (contentToEmit) {
                fullContent += contentToEmit;
                writeStreamChunk(contentToEmit);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 如果循环正常结束，发送结束信号
    const usage = { input_tokens: 0, output_tokens: fullContent.length };
    writeStreamEnd({ content: fullContent, model, usage });
    return;
  }

  // 非流式处理
  const data = await response.json();

  // 提取响应内容 (OpenAI 兼容格式)
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Unexpected API response format: missing choices or message content');
  }

  const message = data.choices[0].message;
  const finishReason = message.finish_reason;

  // 检测工具调用
  if (finishReason === 'tool_calls' && message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      writeToolUseEvent({
        id: toolCall.id,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        }
      });
    }
    // 返回特殊标记，表示有工具调用
    return {
      content: '',
      model: data.model || model,
      usage: {
        input_tokens: data.usage?.prompt_tokens || data.usage?.input_tokens || 0,
        output_tokens: data.usage?.completion_tokens || data.usage?.output_tokens || 0
      },
      tool_calls: message.tool_calls
    };
  }

  const content = message.content;

  return {
    content: content || '',
    model: data.model || model,
    usage: {
      input_tokens: data.usage?.prompt_tokens || data.usage?.input_tokens || 0,
      output_tokens: data.usage?.completion_tokens || data.usage?.output_tokens || 0
    }
  };
}

/**
 * 格式化消息列表，解析 __TOOL_RESULT__ 等特殊标记
 */
function formatMessagesForAnthropic(messages) {
  const formatted = [];
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // 如果是工具结果标记
    if (msg.role === 'user' && msg.content.startsWith('__TOOL_RESULT__:')) {
      const parts = msg.content.split(':');
      const toolCallId = parts[1];
      const content = parts.slice(2).join(':');

      // For OpenAI-compatible APIs, tool results should have role: 'tool', not 'user'
      formatted.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: content
      });
      continue;
    }

    // 如果是包含工具调用的 assistant 消息，需要保留 tool_calls
    if (msg.role === 'assistant' && msg.tool_calls) {
      formatted.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls
      });
      continue;
    }
    formatted.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    });
  }
  
  return formatted;
}

/**
 * 流式调用 Anthropic API
 */
async function callAnthropicStreaming(request) {
  const { apiKey, model, messages, systemPrompt, maxTokens, tools } = request;

  const client = new Anthropic({
    apiKey: apiKey,
  });

  const msgs = formatMessagesForAnthropic(messages);

  // 转换工具格式为 Anthropic 格式
  const anthropicTools = tools?.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }));

  // 使用 Anthropic 的流式 API
  const stream = await client.messages.stream({
    model: model || 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens || 2048,
    system: systemPrompt || undefined,
    messages: msgs,
    ...(anthropicTools && { tools: anthropicTools })
  });

  let fullContent = '';

  // 处理每个 chunk
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta') {
      const text = chunk.delta?.text || '';
      if (text) {
        fullContent += text;
        writeStreamChunk(text);
      }
    } else if (chunk.type === 'message_delta') {
      // 检查是否触发了工具调用
      if (chunk.delta?.stop_reason === 'tool_use') {
        // 工具调用由 finalMessage 获取
      }
    }
  }

  // 流结束，发送结束信号
  const finalMessage = await stream.finalMessage();
  const usage = {
    input_tokens: finalMessage?.usage?.input_tokens || 0,
    output_tokens: finalMessage?.usage?.output_tokens || fullContent.length
  };

  // 检测工具调用
  const toolCalls = finalMessage.content.filter(c => c.type === 'tool_use');
  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      writeToolUseEvent({
        id: toolCall.id,
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.input)
        }
      });
    }
    
    writeStreamEnd({
      content: fullContent,
      model: model || 'claude-3-5-sonnet-20241022',
      usage,
      finishReason: 'tool_use'
    });
    return;
  }

  // 检测 Artifacts
  const artifacts = detectArtifacts(fullContent);

  writeStreamEnd({
    content: fullContent,
    artifacts,
    model: model || 'claude-3-5-sonnet-20241022',
    usage
  });
}

/**
 * 主处理函数
 */
async function main() {
  try {
    // 1. 从 stdin 读取请求
    const request = await readStdin();

    // 2. 验证请求格式
    if (!request.type || request.type !== 'chat') {
      throw new Error('Invalid request type');
    }

    if (!request.apiKey) {
      throw new Error('API key is required');
    }

    if (!request.messages || !Array.isArray(request.messages)) {
      throw new Error('Messages array is required');
    }

    // 检查是否启用流式
    const isStreaming = request.stream === true;

    // 添加工具到请求中 (用于 Function Calling)
    const requestWithTools = {
      ...request,
      tools: TOOLS
    };

    // 3. 根据是否有 baseURL 选择调用方式
    if (request.baseURL) {
      // 使用自定义 API (Minimax 等) - 支持流式
      if (isStreaming) {
        await callCustomAPI(requestWithTools, true);
        return; // 流式处理已完成
      }
      // 非流式
      const response = await callCustomAPI(requestWithTools, false);

      // 如果有工具调用，直接返回（tool_use 事件已经发出）
      if (response.tool_calls) {
        writeStdout({
          type: 'tool_call_pending',
          tool_calls: response.tool_calls,
          model: response.model,
          usage: response.usage
        });
        return;
      }

      // 检测 Artifacts
      const artifacts = detectArtifacts(response.content);

      // 写入 stdout
      writeStdout({
        type: 'response',
        content: response.content,
        artifacts,
        model: response.model,
        usage: response.usage
      });
    } else {
      // 使用 Anthropic API
      if (isStreaming) {
        await callAnthropicStreaming(request);
        return; // 流式处理已完成
      }

      // 非流式
      const client = new Anthropic({
        apiKey: request.apiKey,
      });

      const messages = request.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));

      const anthropicResponse = await client.messages.create({
        model: request.model || 'claude-3-5-sonnet-20241022',
        max_tokens: request.maxTokens || 2048,
        system: request.systemPrompt || undefined,
        messages: messages
      });

      const response = {
        content: anthropicResponse.content[0].text,
        model: anthropicResponse.model,
        usage: {
          input_tokens: anthropicResponse.usage?.input_tokens || 0,
          output_tokens: anthropicResponse.usage?.output_tokens || 0
        }
      };

      // 检测 Artifacts
      const artifacts = detectArtifacts(response.content);

      // 写入 stdout
      writeStdout({
        type: 'response',
        content: response.content,
        artifacts,
        model: response.model,
        usage: response.usage
      });
    }

  } catch (error) {
    // 错误响应
    const errorResponse = {
      type: 'error',
      error: error.message,
      code: error.code || 'unknown_error'
    };
    writeStdout(errorResponse);
    process.exit(1);
  }
}

// 启动
main();
