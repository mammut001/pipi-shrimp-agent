/**
 * Claude SDK Bridge
 *
 * 通过标准输入接收 JSON 请求
 * 调用 Claude/Minimax 等 API
 * 通过标准输出返回 JSON 响应
 */

import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

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
 * 向标准输出写入 JSON 字符串
 */
function writeStdout(data) {
  console.log(JSON.stringify(data));
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
 * 调用自定义 API (Minimax, OpenAI 兼容格式)
 */
async function callCustomAPI(request) {
  const { apiKey, baseURL, model, messages, systemPrompt, maxTokens } = request;

  // 构建请求
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      ...(systemPrompt && { system: systemPrompt }),
      max_tokens: maxTokens || 2048,
      stream: false
    })
  };

  // 调用 API
  const response = await fetch(`${baseURL}/chat/completions`, fetchOptions);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
  }

  const data = await response.json();

  // 提取响应内容 (OpenAI 兼容格式)
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Unexpected API response format: missing choices or message content');
  }

  const content = data.choices[0].message.content;

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

    let response;

    // 3. 根据是否有 baseURL 选择调用方式
    if (request.baseURL) {
      // 使用自定义 API (Minimax 等)
      response = await callCustomAPI(request);
    } else {
      // 使用 Anthropic API
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

      response = {
        content: anthropicResponse.content[0].text,
        model: anthropicResponse.model,
        usage: {
          input_tokens: anthropicResponse.usage?.input_tokens || 0,
          output_tokens: anthropicResponse.usage?.output_tokens || 0
        }
      };
    }

    // 4. 检测 Artifacts
    const artifacts = detectArtifacts(response.content);

    // 5. 构造响应
    const result = {
      type: 'response',
      content: response.content,
      artifacts: artifacts,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens
      }
    };

    // 6. 写入 stdout
    writeStdout(result);

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
