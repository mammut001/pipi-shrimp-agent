export type TranslationKeys = {
  nav: {
    home: string;
    about: string;
    features: string;
    architecture: string;
    changelog: string;
  };
  header: {
    download: string;
    github: string;
  };
  hero: {
    title: string;
    subtitle: string;
    description: string;
    downloadArm: string;
    downloadIntel: string;
    version: string;
  };
  about: {
    title: string;
    description: string;
    features: {
      title: string;
      ai: {
        title: string;
        description: string;
      };
      privacy: {
        title: string;
        description: string;
      };
      fast: {
        title: string;
        description: string;
      };
    };
    thanks: {
      title: string;
      lobsterai: {
        description: string;
      };
      sponsor: {
        badge: string;
      };
      minimax: {
        description: string;
      };
      github: string;
      visitWebsite: string;
    };
  };
  features: {
    title: string;
    subtitle: string;
    list: Array<{
      title: string;
      description: string;
    }>;
  };
  architecture: {
    title: string;
    subtitle: string;
    intro: string;
    layers: Array<{
      title: string;
      description: string;
    }>;
    flow: {
      title: string;
      description: string;
      steps: Array<{
        title: string;
        description: string;
      }>;
    };
    security: {
      title: string;
      description: string;
      items: string[];
    };
    openSource: {
      title: string;
      description: string;
    };
  };
  changelog: {
    title: string;
    subtitle: string;
    loading: string;
    error: string;
    viewOnGithub: string;
    errorTitle: string;
    errorGeneric: string;
    errorTimeout: string;
    errorNetwork: string;
    errorRateLimited: string;
    empty: string;
    retry: string;
    refreshing: string;
    cacheHint: string;
  };
  footer: {
    copyright: string;
    builtWith: string;
  };
  notFound: {
    title: string;
    description: string;
    goHome: string;
    seeFeatures: string;
    readChangelog: string;
    openGithub: string;
  };
};

export type Language = "en" | "fr" | "zh" | "ko" | "vi";

export const translations: Record<Language, TranslationKeys> = {
  en: {
    nav: {
      home: "Home",
      about: "About",
      features: "Features",
      architecture: "Architecture",
      changelog: "Changelog",
    },
    header: {
      download: "Download",
      github: "GitHub",
    },
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "Your intelligent AI assistant, powered by Tauri",
      description: "A blazingly fast, lightweight, and high-performance AI personal assistant built with Tauri + React + TypeScript.",
      downloadArm: "Download for Apple Silicon",
      downloadIntel: "Download for Intel",
      version: "Version",
    },
    about: {
      title: "About",
      description: "Pipi Shrimp Agent is a modern AI assistant designed for speed and native performance. It fully unlocks the tool-calling potential of large language models.",
      features: {
        title: "Key Features",
        ai: {
          title: "Powerful AI Integration",
          description: "Deeply integrated with the Claude SDK, supporting real-time DeepSeek-style reasoning and robust tool calls.",
        },
        privacy: {
          title: "Rich Local Toolchain",
          description: "Execute Bash, Python, and Node.js scripts locally, manage files, and automate the web.",
        },
        fast: {
          title: "Lightning Fast",
          description: "Powered by a Rust and Tauri backend, it boasts instantaneous startup times and minimal memory footprint.",
        },
      },
      thanks: {
        title: "Thanks & Acknowledgments",
        lobsterai: {
          description: "LobsterAI PageAgent by Alibaba provides the inspiration and architecture reference for our agent system.",
        },
        sponsor: {
          badge: "Sponsor",
        },
        minimax: {
          description: "MiniMax generously sponsors this project with API credits and technical support for AI capabilities.",
        },
        github: "View on GitHub",
        visitWebsite: "Visit Website",
      },
    },
    features: {
      title: "Features",
      subtitle: "Everything you need to boost your productivity",
      list: [
        {
          title: "AI Chat with Claude SDK",
          description: "Real-time streaming AI chat powered by Claude SDK. Supports tool calls for executing code, managing files, and web automation.",
        },
        {
          title: "Local Code Execution",
          description: "Execute Bash, Python, and Node.js scripts locally directly from the AI prompt with full output streaming.",
        },
        {
          title: "File System Operations",
          description: "Read, write, search, and manage files and directories. Supports regex and glob patterns for advanced filtering.",
        },
        {
          title: "Web Automation",
          description: "Browse the web and automate browser interactions. Let the agent navigate pages, extract information, and complete web tasks.",
        },
        {
          title: "Typst Document Rendering",
          description: "Integrates the Typst engine for real-time rendering of high-quality SVG/PDF document layouts.",
        },
        {
          title: "Skills Plugin System",
          description: "Built-in utilities for PDF analysis, Excel processing, Word document extraction, and email management.",
        },
        {
          title: "Multi-Agent Workflow",
          description: "Design and execute complex workflows with multiple AI agents working together. Supports conditional routing and feedback loops.",
        },
        {
          title: "Browser Agent",
          description: "Full browser automation with CDP integration. The agent can take screenshots, extract content, and interact with web pages.",
        },
        {
          title: "MCP Server Support",
          description: "Connect to any Model Context Protocol server to extend capabilities. Integrates seamlessly with external tools and data sources.",
        },
        {
          title: "Smart Context Management",
          description: "Automatic context compression with 3-layer system: Microcompact, Session Memory, and Legacy Compact for infinite conversations.",
        },
        {
          title: "Integrated Terminal",
          description: "Full-featured terminal panel embedded in the app. Run commands and see results without switching windows.",
        },
      ],
    },
    architecture: {
      title: "Architecture",
      subtitle: "How Pipi Shrimp Agent is put together",
      intro:
        "Pipi Shrimp Agent is a Tauri desktop application with a Rust backend and a React + TypeScript front end. It is designed around four guiding principles: native performance, local-first privacy, transparent tooling, and a small, well-typed surface area. This page is a high-level tour of how those principles show up in the code.",
      layers: [
        {
          title: "Tauri shell",
          description:
            "The Rust binary is the Tauri shell. It owns the OS window, the webview process, the file-system access policy, and the IPC bridge that the front end uses to talk to the desktop. There is no Node.js runtime in production — everything that would have been a Node module is replaced with a Rust crate or a thin Tauri command.",
        },
        {
          title: "React + TypeScript front end",
          description:
            "The UI is a single-page React application built with the Vite toolchain and bundled by Tauri. State is local where it can be, with a few Zustand stores for cross-cutting concerns like the browser agent and the chat session. The whole UI tree is typed end-to-end so a renamed prop is a compile-time error, not a runtime one.",
        },
        {
          title: "Claude SDK integration",
          description:
            "Conversations are driven by the Claude SDK through a thin adapter. The adapter exposes streaming responses, tool calls, and a small set of host-side capabilities (read/write file, run a shell command, browse a page). The model never sees the host directly — every tool call is brokered by Rust.",
        },
        {
          title: "Local toolchain",
          description:
            "Bash, Python, and Node.js scripts run in a sandboxed child process that the Rust shell supervises. Output streams back over the same IPC channel so the chat UI can render stdout and stderr in real time without polling.",
        },
        {
          title: "Browser agent",
          description:
            "A long-running background task that drives a Chromium instance via the Chrome DevTools Protocol. It captures accessibility snapshots, takes screenshots, clicks elements, and runs in a separate process so a hang on the web never freezes the chat UI.",
        },
        {
          title: "Local persistence",
          description:
            "SQLite stores the conversation history, agent run logs, and per-project preferences. The schema is intentionally narrow: one table per concern, foreign keys turned on, every migration checked in. There is no network database and no sync layer.",
        },
      ],
      flow: {
        title: "What happens when you send a message",
        description:
          "A typical turn in the chat goes through six well-defined steps. Each step is implemented in a single module so a failure in one place is easy to localise.",
        steps: [
          {
            title: "1. Capture",
            description:
              "Your message is appended to the in-memory session and the conversation row is written to SQLite. The input is also mirrored to the on-disk debug log so it can be replayed.",
          },
          {
            title: "2. Context assembly",
            description:
              "The context manager compresses earlier turns in three layers (microcompact, session memory, legacy compact) so long conversations stay within the model's context window without losing important state.",
          },
          {
            title: "3. Model call",
            description:
              "The Claude SDK streams a response back to the UI as tokens arrive. Tool calls are emitted inline as soon as the model decides to use one, rather than at the end of the turn.",
          },
          {
            title: "4. Tool dispatch",
            description:
              "Tool calls cross the IPC bridge into the Rust shell, which enforces the permission policy (read-only by default, write access must be opted into) and runs the requested operation in the right sandbox.",
          },
          {
            title: "5. Result streaming",
            description:
              "Tool results stream back through the same IPC channel. The UI renders them incrementally so a long-running shell command does not freeze the conversation.",
          },
          {
            title: "6. Persistence",
            description:
              "When the model finishes its turn, the final assistant message is committed to SQLite and the session is sealed. The next user message starts a new turn but reuses the same context window.",
          },
        ],
      },
      security: {
        title: "Security model",
        description:
          "The desktop app never sends your data to a server we control. Tool calls and conversation history stay on your machine unless you explicitly opt in to a feature that requires the network (such as fetching a public URL through the browser agent). The permission policy is enforced in Rust, not in JavaScript, so a compromised front end cannot read arbitrary files.",
        items: [
          "Conversations, files, and tool logs are stored locally in SQLite. No telemetry leaves the machine.",
          "Every tool call is mediated by a Rust permission check. The front end cannot bypass it.",
          "External network calls go through a single audited module with a strict allow-list of domains.",
          "Secrets (API keys, OAuth tokens) live in the OS keychain, never in the database or the bundle.",
          "Auto-update is signed; the Tauri shell refuses to launch an update whose signature does not match the project's release key.",
        ],
      },
      openSource: {
        title: "Built in the open",
        description:
          "Pipi Shrimp Agent is open source under the project licence. Issues, pull requests, and design discussions all happen on GitHub. The architecture documented here is the architecture that ships; if you find a discrepancy, that is a bug and we want to know about it.",
      },
    },
    changelog: {
      title: "Changelog",
      subtitle: "Latest updates and improvements",
      loading: "Loading commits...",
      error: "Failed to load commits",
      viewOnGithub: "View on GitHub",
      errorTitle: "Couldn't load the changelog",
      errorGeneric: "Something went wrong while fetching the latest commits. Please try again, or view them directly on GitHub.",
      errorTimeout: "The request to GitHub timed out. Please try again in a moment.",
      errorNetwork: "We couldn't reach GitHub. Check your connection and try again.",
      errorRateLimited: "GitHub temporarily rate-limited our requests. Please try again in a few minutes, or browse the commits directly on GitHub.",
      empty: "No commits to show yet.",
      retry: "Try again",
      refreshing: "Refreshing...",
      cacheHint: "This list refreshes roughly every {seconds} minutes.",
    },
    footer: {
      copyright: "All rights reserved.",
      builtWith: "Built with",
    },
    notFound: {
      title: "Page not found",
      description:
        "The page you are looking for does not exist or has been moved. Pick one of the pages below to get back on track.",
      goHome: "Go home",
      seeFeatures: "See features",
      readChangelog: "Read changelog",
      openGithub: "Open GitHub",
    },
  },
  fr: {
    nav: {
      home: "Accueil",
      about: "À propos",
      features: "Fonctionnalités",
      architecture: "Architecture",
      changelog: "Journal des modifications",
    },
    header: {
      download: "Télécharger",
      github: "GitHub",
    },
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "Votre assistant IA intelligent, propulsé par Tauri",
      description: "Un assistant personnel IA ultra-rapide, léger et performant construit avec Tauri + React + TypeScript.",
      downloadArm: "Télécharger pour Apple Silicon",
      downloadIntel: "Télécharger pour Intel",
      version: "Version",
    },
    about: {
      title: "À propos",
      description: "Pipi Shrimp Agent est conçu pour la vitesse et les performances natives. Il libère tout le potentiel d'appel d'outils des grands modèles de langage.",
      features: {
        title: "Fonctionnalités clés",
        ai: {
          title: "Intégration IA puissante",
          description: "Profondément intégré au SDK Claude, prenant en charge la sortie en streaming et les appels d'outils robustes.",
        },
        privacy: {
          title: "Riche chaîne d'outils locaux",
          description: "Exécutez des scripts Bash, Python et Node.js localement, gérez les fichiers et automatisez le web.",
        },
        fast: {
          title: "Éclair rapide",
          description: "Propulsé par un backend Rust et Tauri, il offre des temps de démarrage instantanés et une empreinte mémoire minimale.",
        },
      },
      thanks: {
        title: "Remerciements",
        lobsterai: {
          description: "LobsterAI PageAgent d'Alibaba fournit l'inspiration et la référence architecturale pour notre système d'agent.",
        },
        sponsor: {
          badge: "Sponsor",
        },
        minimax: {
          description: "MiniMax sponsorise généreusement ce projet avec des crédits API et un support technique pour les capacités IA.",
        },
        github: "Voir sur GitHub",
        visitWebsite: "Visiter le site",
      },
    },
    features: {
      title: "Fonctionnalités",
      subtitle: "Tout ce dont vous avez besoin pour booster votre productivité",
      list: [
        {
          title: "Chat IA avec Claude SDK",
          description: "Chat IA en streaming en temps réel alimenté par Claude SDK. Supporte les appels d'outils pour exécuter du code, gérer des fichiers et automatiser le web.",
        },
        {
          title: "Exécution de code local",
          description: "Exécutez des scripts Bash, Python et Node.js localement directement depuis l'invite IA avec un streaming de sortie complet.",
        },
        {
          title: "Opérations système de fichiers",
          description: "Lire, écrire, rechercher et gérer des fichiers et répertoires. Supporte les regex et les motifs glob pour un filtrage avancé.",
        },
        {
          title: "Automatisation Web",
          description: "Naviguez sur le web et automatisez les interactions avec le navigateur. Laissez l'agent naviguer sur les pages, extraire des informations et accomplir des tâches web.",
        },
        {
          title: "Rendu de document Typst",
          description: "Intègre le moteur Typst pour le rendu en temps réel de mises en page SVG/PDF de haute qualité.",
        },
        {
          title: "Système de plugins de compétences",
          description: "Utilitaires intégrés pour l'analyse PDF, le traitement Excel, l'extraction de documents Word et la gestion des e-mails.",
        },
        {
          title: "Flux de travail multi-agents",
          description: "Concevez et exécutez des flux de travail complexes avec plusieurs agents IA travaillant ensemble. Prend en charge le routage conditionnel et les boucles de rétroaction.",
        },
        {
          title: "Agent de navigateur",
          description: "Automatisation complète du navigateur avec intégration CDP. L'agent peut capturer des écrans, extraire du contenu et interagir avec les pages web.",
        },
        {
          title: "Prise en charge du serveur MCP",
          description: "Connectez-vous à n'importe quel serveur Model Context Protocol pour étendre les capacités. S'intègre parfaitement aux outils et sources de données externes.",
        },
        {
          title: "Gestion intelligente du contexte",
          description: "Compression automatique du contexte avec un système à 3 couches : Microcompact, Mémoire de session et Compression héritée pour des conversations infinies.",
        },
        {
          title: "Terminal intégré",
          description: "Panneau de terminal complet intégré dans l'application. Exécutez des commandes et voyez les résultats sans changer de fenêtre.",
        },
      ],
    },
    architecture: {
      title: "Architecture",
      subtitle: "Comment Pipi Shrimp Agent est assemblé",
      intro:
        "Pipi Shrimp Agent est une application de bureau Tauri avec un backend Rust et un front end React + TypeScript. Elle s'articule autour de quatre principes : performance native, confidentialité locale d'abord, outils transparents et une surface petite et bien typée. Cette page propose une visite guidée de la façon dont ces principes se traduisent dans le code.",
      layers: [
        {
          title: "Coque Tauri",
          description:
            "Le binaire Rust constitue la coque Tauri. Il possède la fenêtre OS, le processus webview, la politique d'accès au système de fichiers et le pont IPC utilisé par le front end pour communiquer avec le bureau. Il n'y a pas de runtime Node.js en production — tout ce qui aurait été un module Node est remplacé par une crate Rust ou une commande Tauri fine.",
        },
        {
          title: "Front end React + TypeScript",
          description:
            "L'interface est une application React monopage construite avec Vite et groupée par Tauri. L'état est local quand c'est possible, avec quelques stores Zustand pour les préoccupations transverses comme l'agent de navigateur et la session de chat. L'ensemble de l'arbre UI est typé de bout en bout pour qu'une prop renommée soit une erreur de compilation, pas d'exécution.",
        },
        {
          title: "Intégration Claude SDK",
          description:
            "Les conversations sont pilotées par le Claude SDK via un adaptateur fin. L'adaptateur expose des réponses en streaming, des appels d'outils et un petit ensemble de capacités côté hôte (lire/écrire un fichier, exécuter une commande shell, parcourir une page). Le modèle ne voit jamais l'hôte directement — chaque appel d'outil est servi par Rust.",
        },
        {
          title: "Chaîne d'outils locale",
          description:
            "Les scripts Bash, Python et Node.js s'exécutent dans un processus enfant sandboxé supervisé par la coque Rust. La sortie revient par le même canal IPC pour que l'UI de chat puisse afficher stdout et stderr en temps réel sans sondage.",
        },
        {
          title: "Agent de navigateur",
          description:
            "Une tâche de fond de longue durée qui pilote une instance Chromium via le Chrome DevTools Protocol. Il capture des instantanés d'accessibilité, prend des captures d'écran, clique sur des éléments, et s'exécute dans un processus séparé pour qu'un blocage sur le web ne gèle jamais l'UI de chat.",
        },
        {
          title: "Persistance locale",
          description:
            "SQLite stocke l'historique des conversations, les journaux d'exécution de l'agent et les préférences par projet. Le schéma est volontairement étroit : une table par préoccupation, clés étrangères activées, chaque migration archivée. Pas de base réseau ni de couche de synchronisation.",
        },
      ],
      flow: {
        title: "Ce qui se passe quand vous envoyez un message",
        description:
          "Un tour typique du chat passe par six étapes bien définies. Chaque étape est implémentée dans un seul module pour qu'une défaillance soit facile à localiser.",
        steps: [
          {
            title: "1. Capture",
            description:
              "Votre message est ajouté à la session en mémoire et la ligne de conversation est écrite dans SQLite. L'entrée est aussi mise en miroir dans le journal de débogage sur disque pour pouvoir être rejouée.",
          },
          {
            title: "2. Assemblage du contexte",
            description:
              "Le gestionnaire de contexte compresse les tours précédents en trois couches (microcompact, mémoire de session, compact hérité) pour que les longues conversations restent dans la fenêtre de contexte du modèle sans perdre d'état important.",
          },
          {
            title: "3. Appel au modèle",
            description:
              "Le Claude SDK streame une réponse vers l'UI au fur et à mesure que les tokens arrivent. Les appels d'outils sont émis en ligne dès que le modèle décide d'en utiliser un, plutôt qu'à la fin du tour.",
          },
          {
            title: "4. Dispatch des outils",
            description:
              "Les appels d'outils traversent le pont IPC vers la coque Rust, qui applique la politique de permissions (lecture seule par défaut, l'accès en écriture doit être activé) et exécute l'opération demandée dans le bon sandbox.",
          },
          {
            title: "5. Streaming des résultats",
            description:
              "Les résultats des outils reviennent par le même canal IPC. L'UI les rend de façon incrémentale pour qu'une commande shell longue ne fige pas la conversation.",
          },
          {
            title: "6. Persistance",
            description:
              "Quand le modèle termine son tour, le message final de l'assistant est validé dans SQLite et la session est scellée. Le message utilisateur suivant commence un nouveau tour mais réutilise la même fenêtre de contexte.",
          },
        ],
      },
      security: {
        title: "Modèle de sécurité",
        description:
          "L'application de bureau n'envoie jamais vos données à un serveur que nous contrôlons. Les appels d'outils et l'historique des conversations restent sur votre machine sauf si vous activez explicitement une fonctionnalité qui requiert le réseau (comme la récupération d'une URL publique via l'agent navigateur). La politique de permissions est appliquée en Rust, pas en JavaScript, pour qu'un front end compromis ne puisse pas lire de fichiers arbitraires.",
        items: [
          "Les conversations, fichiers et journaux d'outils sont stockés localement dans SQLite. Aucune télémétrie ne quitte la machine.",
          "Chaque appel d'outil est médié par une vérification de permission Rust. Le front end ne peut pas la contourner.",
          "Les appels réseau externes passent par un seul module audité avec une liste blanche stricte de domaines.",
          "Les secrets (clés API, jetons OAuth) vivent dans le trousseau OS, jamais dans la base ni dans le bundle.",
          "La mise à jour automatique est signée ; la coque Tauri refuse de lancer une mise à jour dont la signature ne correspond pas à la clé de release du projet.",
        ],
      },
      openSource: {
        title: "Construit en ouvert",
        description:
          "Pipi Shrimp Agent est open source sous la licence du projet. Les issues, pull requests et discussions de design se passent sur GitHub. L'architecture documentée ici est celle qui est livrée ; si vous trouvez un écart, c'est un bug et nous voulons le savoir.",
      },
    },
    changelog: {
      title: "Journal des modifications",
      subtitle: "Dernières mises à jour et améliorations",
      loading: "Chargement des commits...",
      error: "Échec du chargement des commits",
      viewOnGithub: "Voir sur GitHub",
      errorTitle: "Impossible de charger le journal",
      errorGeneric: "Une erreur s'est produite lors de la récupération des commits. Veuillez réessayer ou les consulter directement sur GitHub.",
      errorTimeout: "La requête vers GitHub a expiré. Veuillez réessayer dans un instant.",
      errorNetwork: "Impossible de joindre GitHub. Vérifiez votre connexion et réessayez.",
      errorRateLimited: "GitHub a temporairement limité nos requêtes. Réessayez dans quelques minutes ou consultez les commits directement sur GitHub.",
      empty: "Aucun commit à afficher pour le moment.",
      retry: "Réessayer",
      refreshing: "Actualisation...",
      cacheHint: "Cette liste est actualisée environ toutes les {seconds} minutes.",
    },
    footer: {
      copyright: "Tous droits réservés.",
      builtWith: "Construit avec",
    },
    notFound: {
      title: "Page introuvable",
      description:
        "La page que vous cherchez n'existe pas ou a été déplacée. Choisissez une page ci-dessous pour continuer.",
      goHome: "Retour à l'accueil",
      seeFeatures: "Voir les fonctionnalités",
      readChangelog: "Lire le journal des modifications",
      openGithub: "Ouvrir GitHub",
    },
  },
  zh: {
    nav: {
      home: "首页",
      about: "关于",
      features: "功能",
      architecture: "架构",
      changelog: "更新日志",
    },
    header: {
      download: "下载",
      github: "GitHub",
    },
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "您的智能本地 AI 助手",
      description: "一个极致轻量级、高性能的 AI 个人助手，基于 Tauri + React + TypeScript 打造。",
      downloadArm: "下载 Apple Silicon 版",
      downloadIntel: "下载 Intel 版",
      version: "版本",
    },
    about: {
      title: "关于",
      description: "Pipi Shrimp Agent 旨在提供快速、强大的本地 AI 客户端，彻底释放大语言模型的工具调用潜力。",
      features: {
        title: "核心功能",
        ai: {
          title: "强大的大模型集成",
          description: "深度集成 Claude SDK，支持实时的 DeepSeek 风格\"思考\"过程 (Reasoning) 和强大的工具调用能力。",
        },
        privacy: {
          title: "丰富的本地化工具链",
          description: "本地执行 Bash, Python 和 Node.js 脚本，强大的文件管理和 Web 自动化功能。",
        },
        fast: {
          title: "极致轻量与原生性能",
          description: "基于 Rust 和 Tauri 构建后端，极速启动，内存占用极低。",
        },
      },
      thanks: {
        title: "感谢与致谢",
        lobsterai: {
          description: "阿里巴巴的 LobsterAI PageAgent 为我们的 Agent 系统提供了架构参考和灵感启发。",
        },
        sponsor: {
          badge: "赞助商",
        },
        minimax: {
          description: "MiniMax 慷慨地为该项目提供 API 额度和技术支持，助力 AI 能力的实现。",
        },
        github: "在 GitHub 上查看",
        visitWebsite: "访问官网",
      },
    },
    features: {
      title: "功能",
      subtitle: "提升生产力所需的一切",
      list: [
        {
          title: "Claude SDK AI 聊天",
          description: "基于 Claude SDK 的实时流式 AI 对话。支持工具调用，可执行代码、管理文件和自动化 Web 操作。",
        },
        {
          title: "本地代码执行",
          description: "在本地直接执行 Bash、Python 和 Node.js 脚本，配合完整输出流。",
        },
        {
          title: "文件系统操作",
          description: "读取、写入、搜索和管理文件与目录。支持正则表达式和 Glob 模式进行高级过滤。",
        },
        {
          title: "Web 自动化",
          description: "浏览网页并自动化浏览器交互。让 Agent 导航页面、提取信息并完成 Web 任务。",
        },
        {
          title: "Typst 文档渲染",
          description: "集成 Typst 引擎，支持实时渲染高质量 SVG/PDF 文档排版。",
        },
        {
          title: "技能插件系统",
          description: "内置 PDF 分析、Excel 处理、Word 文档提取和邮件管理等实用工具。",
        },
        {
          title: "多代理工作流",
          description: "设计并执行复杂工作流，多个 AI 代理协同工作。支持条件路由和反馈循环。",
        },
        {
          title: "浏览器代理",
          description: "基于 CDP 集成实现完整浏览器自动化。Agent 可截取屏幕截图、提取内容并与网页交互。",
        },
        {
          title: "MCP 服务器支持",
          description: "连接任何 Model Context Protocol 服务器以扩展功能。无缝集成外部工具和数据源。",
        },
        {
          title: "智能上下文管理",
          description: "三层自动上下文压缩系统：Microcompact、会话内存和传统压缩，实现无限长度对话。",
        },
        {
          title: "集成终端",
          description: "应用内嵌入全功能终端面板。无需切换窗口即可运行命令并查看结果。",
        },
      ],
    },
    architecture: {
      title: "架构",
      subtitle: "Pipi Shrimp Agent 的内部构成",
      intro:
        "Pipi Shrimp Agent 是一个使用 Tauri 构建的桌面应用，后端为 Rust，前端为 React + TypeScript。它的设计围绕四个原则：原生性能、本地优先的隐私、工具链透明、以及小而精确的类型化接口。本页面是对这些原则如何在代码中落地的概览。",
      layers: [
        {
          title: "Tauri 外壳",
          description:
            "Rust 二进制就是 Tauri 外壳。它拥有操作系统窗口、WebView 进程、文件系统访问策略，以及前端用来与桌面通信的 IPC 桥。生产环境没有 Node.js 运行时 —— 任何原本会是 Node 模块的部分，都由 Rust crate 或一层薄薄的 Tauri 命令替代。",
        },
        {
          title: "React + TypeScript 前端",
          description:
            "界面是用 Vite 构建、由 Tauri 打包的单页 React 应用。状态尽量保持局部，只有跨页面共享的部分（浏览器代理、聊天会话）用少量 Zustand store 维护。整个 UI 树端到端类型化，重命名一个 prop 是编译错误而不是运行时错误。",
        },
        {
          title: "Claude SDK 集成",
          description:
            "会话由 Claude SDK 通过一个薄适配器驱动。适配器暴露流式响应、工具调用，以及一组主机端能力（读/写文件、执行 shell 命令、浏览页面）。模型从不直接看到主机 —— 每个工具调用都由 Rust 中转。",
        },
        {
          title: "本地工具链",
          description:
            "Bash、Python 和 Node.js 脚本在 Rust 外壳监管的沙箱子进程中运行。输出通过同一条 IPC 通道回传，让聊天 UI 能实时渲染 stdout 和 stderr，无需轮询。",
        },
        {
          title: "浏览器代理",
          description:
            "一个常驻后台任务，通过 Chrome DevTools Protocol 驱动 Chromium 实例。它抓取无障碍快照、截图、点击元素，并跑在独立进程中，因此网页卡死永远不会冻结聊天 UI。",
        },
        {
          title: "本地持久化",
          description:
            "SQLite 存储对话历史、代理运行日志和每个项目的偏好设置。模式有意保持精简：一个关注点一张表、启用外键、每次迁移都入版本库。没有网络数据库，也没有同步层。",
        },
      ],
      flow: {
        title: "当你发送一条消息时发生了什么",
        description:
          "一次典型的聊天回合会经过六个明确步骤。每一步都在单一模块内实现，便于故障定位。",
        steps: [
          {
            title: "1. 捕获",
            description:
              "你的消息被追加到内存中的会话，对话行被写入 SQLite。输入还会镜像到磁盘上的调试日志，方便回放。",
          },
          {
            title: "2. 上下文组装",
            description:
              "上下文管理器用三层压缩机制（Microcompact、会话内存、传统压缩）压缩早期回合，让长对话在不丢失重要状态的情况下保持在模型的上下文窗口内。",
          },
          {
            title: "3. 模型调用",
            description:
              "Claude SDK 一边生成 token 一边向 UI 流式回传响应。工具调用在模型决定使用时立刻内联发出，而不是等到回合结束。",
          },
          {
            title: "4. 工具派发",
            description:
              "工具调用跨过 IPC 桥进入 Rust 外壳，由它强制执行权限策略（默认只读，写入权限必须显式开启），并在正确的沙箱中运行请求的操作。",
          },
          {
            title: "5. 结果流式回传",
            description:
              "工具结果沿同一条 IPC 通道流回。UI 增量渲染，因此一条长时间运行的 shell 命令不会冻住对话。",
          },
          {
            title: "6. 持久化",
            description:
              "模型结束回合后，最终的助手消息被提交到 SQLite，会话被封存。下一条用户消息开启新回合，但复用同一上下文窗口。",
          },
        ],
      },
      security: {
        title: "安全模型",
        description:
          "桌面应用从不会把你的数据发送到我们控制的服务器。除非你显式开启需要联网的功能（例如通过浏览器代理抓取公共 URL），否则工具调用和对话历史都保留在你的机器上。权限策略由 Rust 而非 JavaScript 强制执行，因此即便前端被攻破，也无法读取任意文件。",
        items: [
          "对话、文件和工具日志都存储在本地 SQLite 中。没有遥测数据离开本机。",
          "每次工具调用都经由 Rust 的权限检查。前端无法绕过。",
          "外部网络调用走唯一的已审计模块，并配有严格的域名白名单。",
          "密钥（API Key、OAuth 令牌）存放在操作系统钥匙串中，从不写入数据库或 bundle。",
          "自动更新经过签名；Tauri 外壳拒绝启动签名与项目发布密钥不匹配的更新。",
        ],
      },
      openSource: {
        title: "开放构建",
        description:
          "Pipi Shrimp Agent 在项目许可证下开源。Issue、PR 和设计讨论都在 GitHub 上进行。这里描述的架构就是发布的架构；如果你发现不一致，那就是 bug，欢迎告诉我们。",
      },
    },
    changelog: {
      title: "更新日志",
      subtitle: "最新更新和改进",
      loading: "加载提交中...",
      error: "加载提交失败",
      viewOnGithub: "在 GitHub 上查看",
      errorTitle: "无法加载更新日志",
      errorGeneric: "获取最新提交时出现问题。请重试，或直接在 GitHub 上查看。",
      errorTimeout: "请求 GitHub 超时。请稍后重试。",
      errorNetwork: "无法连接到 GitHub。请检查网络后重试。",
      errorRateLimited: "GitHub 暂时限制了我们的请求。请几分钟后重试，或直接在 GitHub 上查看。",
      empty: "暂无提交可显示。",
      retry: "重试",
      refreshing: "刷新中...",
      cacheHint: "此列表大约每 {seconds} 分钟刷新一次。",
    },
    footer: {
      copyright: "版权所有。",
      builtWith: "由",
    },
    notFound: {
      title: "页面未找到",
      description:
        "您访问的页面不存在或已被移动。请选择下方任一页面继续浏览。",
      goHome: "返回首页",
      seeFeatures: "查看功能",
      readChangelog: "阅读更新日志",
      openGithub: "打开 GitHub",
    },
  },
  ko: {
    nav: {
      home: "홈",
      about: "정보",
      features: "기능",
      architecture: "아키텍처",
      changelog: "변경 로그",
    },
    header: {
      download: "다운로드",
      github: "GitHub",
    },
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "Tauri로 구동되는 지능형 AI 어시스턴트",
      description: "Tauri + React + TypeScript로 구축된 매우 빠르고 가벼우며 성능이 뛰어난 AI 개인 비서입니다.",
      downloadArm: "Apple Silicon용 다운로드",
      downloadIntel: "Intel용 다운로드",
      version: "버전",
    },
    about: {
      title: "정보",
      description: "Pipi Shrimp Agent는 속도와 네이티브 성능을 위해 설계된 현대적인 AI 어시스턴트입니다. 대규모 언어 모델의 도구 호출 잠재력을 완전히 끌어냅니다.",
      features: {
        title: "주요 기능",
        ai: {
          title: "강력한 AI 통합",
          description: "Claude SDK와 깊이 통합되어 실시간 스트리밍 출력 및 강력한 도구 호출을 지원합니다.",
        },
        privacy: {
          title: "풍부한 로컬 도구 체인",
          description: "Bash, Python 및 Node.js 스크립트를 로컬에서 실행하고 파일을 관리하며 웹을 자동화합니다.",
        },
        fast: {
          title: "번개처럼 빠름",
          description: "Rust 및 Tauri 백엔드로 구동되어 즉각적인 시작 시간과 최소한의 메모리 사용 공간을 자랑합니다.",
        },
      },
      thanks: {
        title: "감사 및 표창",
        lobsterai: {
          description: "Alibaba의 LobsterAI PageAgent는 에이전트 시스템에 대한 영감과 아키텍처 레퍼런스를 제공합니다.",
        },
        sponsor: {
          badge: "스폰서",
        },
        minimax: {
          description: "MiniMax는 이 프로젝트에 AI 기능을 위한 API 크레딧과 기술 지원을 아낌없이 후원합니다.",
        },
        github: "GitHub에서 보기",
        visitWebsite: "웹사이트 방문",
      },
    },
    features: {
      title: "기능",
      subtitle: "생산성을 높이기 위해 필요한 모든 것",
      list: [
        {
          title: "Claude SDK AI 채팅",
          description: "Claude SDK로 구동되는 실시간 스트리밍 AI 채팅. 코드 실행, 파일 관리 및 웹 자동화를 위한 도구 호출을 지원합니다.",
        },
        {
          title: "로컬 코드 실행",
          description: "AI 프롬프트에서 직접 Bash, Python 및 Node.js 스크립트를 전체 출력 스트리밍과 함께 로컬에서 실행합니다.",
        },
        {
          title: "파일 시스템 작업",
          description: "파일 및 디렉토리 읽기, 쓰기, 검색 및 관리. 고급 필터링을 위한 정규식 및 glob 패턴을 지원합니다.",
        },
        {
          title: "웹 자동화",
          description: "웹을 탐색하고 브라우저 상호작용을 자동화합니다. 에이전트가 페이지를 탐색하고 정보를 추출하며 웹 작업을 완료하도록 하세요.",
        },
        {
          title: "Typst 문서 렌더링",
          description: "고품질 SVG/PDF 문서 레이아웃의 실시간 렌더링을 위한 Typst 엔진 통합.",
        },
        {
          title: "스킬 플러그인 시스템",
          description: "PDF 분석, Excel 처리, Word 문서 추출 및 이메일 관리를 위한 내장 유틸리티.",
        },
        {
          title: "멀티 에이전트 워크플로우",
          description: "복잡한 워크플로우를 설계하고 실행하며, 여러 AI 에이전트가 함께 작업합니다. 조건부 라우팅 및 피드백 루프를 지원합니다.",
        },
        {
          title: "브라우저 에이전트",
          description: "CDP 통합으로 완전한 브라우저 자동화. 에이전트가 스크린샷을 캡처하고 콘텐츠를 추출하며 웹 페이지와 상호 작용할 수 있습니다.",
        },
        {
          title: "MCP 서버 지원",
          description: "모든 Model Context Protocol 서버에 연결하여 기능을 확장합니다. 외부 도구 및 데이터 소스와 원활하게 통합됩니다.",
        },
        {
          title: "스마트 컨텍스트 관리",
          description: "3층 시스템으로 자동 컨텍스트 압축: 마이크로컴팩트, 세션 메모리 및 레거시 컴팩트로 무한 대화 가능.",
        },
        {
          title: "통합 터미널",
          description: "앱 내에 내장된 완전한 기능의 터미널 패널. 창을 전환하지 않고 명령을 실행하고 결과를 볼 수 있습니다.",
        },
      ],
    },
    architecture: {
      title: "아키텍처",
      subtitle: "Pipi Shrimp Agent의 내부 구조",
      intro:
        "Pipi Shrimp Agent는 Rust 백엔드와 React + TypeScript 프런트엔드로 구성된 Tauri 데스크톱 앱입니다. 네 가지 원칙 — 네이티브 성능, 로컬 우선 프라이버시, 투명한 도구, 작고 잘 타입된 표면 — 을 중심으로 설계되었습니다. 이 페이지는 그 원칙이 코드에서 어떻게 나타나는지 상위 수준에서 살펴봅니다.",
      layers: [
        {
          title: "Tauri 셸",
          description:
            "Rust 바이너리가 Tauri 셸입니다. OS 창, 웹뷰 프로세스, 파일 시스템 접근 정책, 그리고 프런트엔드가 데스크톱과 소통하는 IPC 브릿지를 소유합니다. 프로덕션에는 Node.js 런타임이 없습니다 — Node 모듈이 될 만한 것은 모두 Rust crate나 얇은 Tauri 커맨드로 대체됩니다.",
        },
        {
          title: "React + TypeScript 프런트엔드",
          description:
            "UI는 Vite로 빌드되고 Tauri가 번들링하는 SPA입니다. 상태는 가능한 한 로컬로 유지하고, 브라우저 에이전트와 채팅 세션처럼 횡단 관심사에는 소수의 Zustand 스토어를 사용합니다. UI 트리 전체가 엔드 투 엔드로 타입되어 있어 prop 이름 변경은 런타임 오류가 아닌 컴파일 오류가 됩니다.",
        },
        {
          title: "Claude SDK 통합",
          description:
            "대화는 얇은 어댑터를 통해 Claude SDK가 구동합니다. 어댑터는 스트리밍 응답, 도구 호출, 그리고 호스트 측 기능(파일 읽기/쓰기, 셸 명령 실행, 페이지 탐색)을 제공합니다. 모델은 호스트를 직접 보지 못하며, 모든 도구 호출은 Rust가 중개합니다.",
        },
        {
          title: "로컬 도구 체인",
          description:
            "Bash, Python, Node.js 스크립트는 Rust 셸이 감독하는 샌드박스 자식 프로세스에서 실행됩니다. 출력은 동일한 IPC 채널을 통해 흘러 채팅 UI가 폴링 없이 실시간으로 stdout/stderr을 렌더링할 수 있습니다.",
        },
        {
          title: "브라우저 에이전트",
          description:
            "Chrome DevTools Protocol로 Chromium 인스턴스를 구동하는 장기 실행 백그라운드 작업입니다. 접근성 스냅샷을 캡처하고, 스크린샷을 찍고, 요소를 클릭하며, 별도 프로세스에서 실행되어 웹에서의 행이 채팅 UI를 절대 멈추지 않습니다.",
        },
        {
          title: "로컬 영속성",
          description:
            "SQLite가 대화 기록, 에이전트 실행 로그, 프로젝트별 환경설정을 저장합니다. 스키마는 의도적으로 좁습니다 — 관심사당 하나의 테이블, 외래 키 활성화, 모든 마이그레이션 버전 관리. 네트워크 데이터베이스도, 동기화 계층도 없습니다.",
        },
      ],
      flow: {
        title: "메시지를 보냈을 때 일어나는 일",
        description:
          "전형적인 채팅 한 턴은 잘 정의된 여섯 단계를 거칩니다. 각 단계는 단일 모듈에 구현되어 있어 한 곳의 실패를 쉽게 격리할 수 있습니다.",
        steps: [
          {
            title: "1. 캡처",
            description:
              "메시지가 메모리 세션에 추가되고 대화 행이 SQLite에 기록됩니다. 입력은 디스크의 디버그 로그에도 미러링되어 재실행할 수 있습니다.",
          },
          {
            title: "2. 컨텍스트 조립",
            description:
              "컨텍스트 관리자가 세 계층(마이크로컴팩트, 세션 메모리, 레거시 컴팩트)으로 이전 턴을 압축해, 중요한 상태를 잃지 않으면서도 긴 대화를 모델의 컨텍스트 창 안에 유지합니다.",
          },
          {
            title: "3. 모델 호출",
            description:
              "Claude SDK가 토큰이 생성되는 대로 응답을 UI에 스트리밍합니다. 도구 호출은 턴 끝이 아니라 모델이 사용하기로 결정하는 즉시 인라인으로 방출됩니다.",
          },
          {
            title: "4. 도구 디스패치",
            description:
              "도구 호출은 IPC 브릿지를 통해 Rust 셸로 넘어가고, 셸이 권한 정책(기본값은 읽기 전용, 쓰기 권한은 옵트인)을 적용해 올바른 샌드박스에서 요청된 작업을 실행합니다.",
          },
          {
            title: "5. 결과 스트리밍",
            description:
              "도구 결과는 동일한 IPC 채널을 통해 스트리밍됩니다. UI가 점진적으로 렌더링하므로 긴 셸 명령이 대화를 멈추지 않습니다.",
          },
          {
            title: "6. 영속화",
            description:
              "모델이 턴을 마치면 최종 어시스턴트 메시지가 SQLite에 커밋되고 세션이 봉인됩니다. 다음 사용자 메시지는 새 턴을 시작하지만 같은 컨텍스트 창을 재사용합니다.",
          },
        ],
      },
      security: {
        title: "보안 모델",
        description:
          "데스크톱 앱은 사용자의 데이터를 우리가 통제하는 서버로 절대 전송하지 않습니다. 네트워크가 필요한 기능(브라우저 에이전트를 통한 공개 URL 가져오기 등)을 명시적으로 켜지 않는 한, 도구 호출과 대화 기록은 모두 사용자 컴퓨터에 머뭅니다. 권한 정책은 JavaScript가 아니라 Rust에서 적용되므로 프런트엔드가 손상되더라도 임의의 파일을 읽을 수 없습니다.",
        items: [
          "대화, 파일, 도구 로그는 모두 로컬 SQLite에 저장됩니다. 어떤 원격 측정도 기기를 떠나지 않습니다.",
          "모든 도구 호출은 Rust의 권한 검사를 거칩니다. 프런트엔드는 이를 우회할 수 없습니다.",
          "외부 네트워크 호출은 단일 감사 모듈을 거치며 엄격한 도메인 화이트리스트를 따릅니다.",
          "비밀(API 키, OAuth 토큰)은 OS 키체인에 보관되며 데이터베이스나 번들에 절대 들어가지 않습니다.",
          "자동 업데이트는 서명되며, Tauri 셸은 프로젝트 릴리스 키와 일치하지 않는 서명의 업데이트 실행을 거부합니다.",
        ],
      },
      openSource: {
        title: "오픈 방식으로 만들기",
        description:
          "Pipi Shrimp Agent는 프로젝트 라이선스 하에 오픈 소스입니다. 이슈, PR, 설계 논의는 모두 GitHub에서 이루어집니다. 여기에 문서화된 아키텍처가 그대로 출시되는 아키텍처입니다. 불일치를 발견하시면 그건 버그이니 알려주세요.",
      },
    },
    changelog: {
      title: "변경 로그",
      subtitle: "최신 업데이트 및 개선 사항",
      loading: "커밋 로드 중...",
      error: "커밋 로드 실패",
      viewOnGithub: "GitHub에서 보기",
      errorTitle: "변경 로그를 불러올 수 없습니다",
      errorGeneric: "최신 커밋을 가져오는 중 문제가 발생했습니다. 다시 시도하거나 GitHub에서 직접 확인하세요.",
      errorTimeout: "GitHub 요청이 시간 초과되었습니다. 잠시 후 다시 시도하세요.",
      errorNetwork: "GitHub에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.",
      errorRateLimited: "GitHub에서 일시적으로 요청을 제한했습니다. 몇 분 후 다시 시도하거나 GitHub에서 직접 커밋을 확인하세요.",
      empty: "표시할 커밋이 없습니다.",
      retry: "다시 시도",
      refreshing: "새로 고치는 중...",
      cacheHint: "이 목록은 약 {seconds}분마다 새로 고쳐집니다.",
    },
    footer: {
      copyright: "모든 권리 보유.",
      builtWith: "만든 곳",
    },
    notFound: {
      title: "페이지를 찾을 수 없습니다",
      description:
        "찾고 계신 페이지가 존재하지 않거나 이동되었습니다. 아래 페이지 중 하나를 선택해 계속 진행하세요.",
      goHome: "홈으로",
      seeFeatures: "기능 보기",
      readChangelog: "변경 로그 보기",
      openGithub: "GitHub 열기",
    },
  },
  vi: {
    nav: {
      home: "Trang chủ",
      about: "Giới thiệu",
      features: "Tính năng",
      architecture: "Kiến trúc",
      changelog: "Nhật ký thay đổi",
    },
    header: {
      download: "Tải xuống",
      github: "GitHub",
    },
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "Trợ lý AI thông minh của bạn, được hỗ trợ bởi Tauri",
      description: "Một trợ lý cá nhân AI cực nhanh, nhẹ và hiệu suất cao được xây dựng bằng Tauri + React + TypeScript.",
      downloadArm: "Tải cho Apple Silicon",
      downloadIntel: "Tải cho Intel",
      version: "Phiên bản",
    },
    about: {
      title: "Giới thiệu",
      description: "Pipi Shrimp Agent là một trợ lý AI hiện đại được thiết kế cho tốc độ và hiệu suất gốc. Nó mở khóa hoàn toàn tiềm năng gọi công cụ của các mô hình ngôn ngữ lớn.",
      features: {
        title: "Tính năng chính",
        ai: {
          title: "Tích hợp AI mạnh mẽ",
          description: "Tích hợp sâu với Claude SDK, hỗ trợ đầu ra phát trực tuyến theo thời gian thực và gọi công cụ mạnh mẽ.",
        },
        privacy: {
          title: "Chuỗi công cụ cục bộ phong phú",
          description: "Thực thi các tệp lệnh Bash, Python và Node.js cục bộ, quản lý tệp và tự động hóa web.",
        },
        fast: {
          title: "Nhanh như chớp",
          description: "Được cung cấp bởi backend Rust và Tauri, nó có thời gian khởi động tức thì và dung lượng bộ nhớ tối thiểu.",
        },
      },
      thanks: {
        title: "Lời Cảm Ơn",
        lobsterai: {
          description: "LobsterAI PageAgent của Alibaba cung cấp nguồn cảm hứng và tài liệu tham khảo kiến trúc cho hệ thống agent của chúng tôi.",
        },
        sponsor: {
          badge: "Nhà tài trợ",
        },
        minimax: {
          description: "MiniMax hào phóng tài trợ dự án này với credit API và hỗ trợ kỹ thuật cho các khả năng AI.",
        },
        github: "Xem trên GitHub",
        visitWebsite: "Truy cập trang web",
      },
    },
    features: {
      title: "Tính năng",
      subtitle: "Mọi thứ bạn cần để tăng năng suất",
      list: [
        {
          title: "Trò chuyện AI với Claude SDK",
          description: "Trò chuyện AI streaming thời gian thực được cung cấp bởi Claude SDK. Hỗ trợ gọi công cụ để thực thi mã, quản lý tệp và tự động hóa web.",
        },
        {
          title: "Thực thi mã cục bộ",
          description: "Thực thi các tệp lệnh Bash, Python và Node.js cục bộ trực tiếp từ lời nhắc AI với streaming đầu ra đầy đủ.",
        },
        {
          title: "Thao tác hệ thống tệp",
          description: "Đọc, ghi, tìm kiếm và quản lý tệp và thư mục. Hỗ trợ regex và mẫu glob để lọc nâng cao.",
        },
        {
          title: "Tự động hóa Web",
          description: "Duyệt web và tự động hóa tương tác trình duyệt. Để agent điều hướng trang, trích xuất thông tin và hoàn thành tác vụ web.",
        },
        {
          title: "Kết xuất tài liệu Typst",
          description: "Tích hợp công cụ Typst để kết xuất bố cục SVG/PDF chất lượng cao theo thời gian thực.",
        },
        {
          title: "Hệ thống plugin kỹ năng",
          description: "Tiện ích tích hợp cho phân tích PDF, xử lý Excel, trích xuất tài liệu Word và quản lý email.",
        },
        {
          title: "Quy trình làm việc đa tác tử",
          description: "Thiết kế và thực thi các quy trình phức tạp với nhiều tác tử AI làm việc cùng nhau. Hỗ trợ định tuyến có điều kiện và vòng lặp phản hồi.",
        },
        {
          title: "Tác tử trình duyệt",
          description: "Tự động hóa trình duyệt đầy đủ với tích hợp CDP. Tác tử có thể chụp ảnh màn hình, trích xuất nội dung và tương tác với các trang web.",
        },
        {
          title: "Hỗ trợ máy chủ MCP",
          description: "Kết nối với bất kỳ máy chủ Model Context Protocol nào để mở rộng khả năng. Tích hợp liền mạch với các công cụ và nguồn dữ liệu bên ngoài.",
        },
        {
          title: "Quản lý ngữ cảnh thông minh",
          description: "Nén ngữ cảnh tự động với hệ thống 3 lớp: Microcompact, Bộ nhớ phiên và Compact cổ điển cho các cuộc trò chuyện vô hạn.",
        },
        {
          title: "Terminal tích hợp",
          description: "Bảng terminal đầy đủ tính năng được nhúng trong ứng dụng. Chạy lệnh và xem kết quả mà không cần chuyển đổi cửa sổ.",
        },
      ],
    },
    architecture: {
      title: "Kiến trúc",
      subtitle: "Cách Pipi Shrimp Agent được xây dựng",
      intro:
        "Pipi Shrimp Agent là ứng dụng desktop Tauri với backend Rust và front end React + TypeScript. Nó được thiết kế xoay quanh bốn nguyên tắc: hiệu suất gốc, quyền riêng tư ưu tiên cục bộ, công cụ minh bạch và diện tích type nhỏ gọn. Trang này là chuyến tham quan cấp cao về cách những nguyên tắc đó thể hiện trong mã nguồn.",
      layers: [
        {
          title: "Vỏ Tauri",
          description:
            "Tệp nhị phân Rust chính là vỏ Tauri. Nó sở hữu cửa sổ OS, tiến trình webview, chính sách truy cập hệ thống tệp và cầu IPC mà front end sử dụng để giao tiếp với desktop. Không có runtime Node.js trong sản phẩm — mọi thứ lẽ ra là module Node đều được thay thế bằng crate Rust hoặc lệnh Tauri mỏng.",
        },
        {
          title: "Front end React + TypeScript",
          description:
            "Giao diện là ứng dụng React một trang xây dựng bằng công cụ Vite và đóng gói bởi Tauri. Trạng thái được giữ cục bộ khi có thể, với vài store Zustand cho các mối quan tâm cắt ngang như agent trình duyệt và phiên trò chuyện. Toàn bộ cây UI được type hóa đầu cuối để đổi tên prop là lỗi biên dịch, không phải lỗi runtime.",
        },
        {
          title: "Tích hợp Claude SDK",
          description:
            "Cuộc trò chuyện được điều khiển bởi Claude SDK thông qua bộ điều hợp mỏng. Bộ điều hợp expose phản hồi streaming, gọi công cụ và một tập nhỏ khả năng phía máy chủ (đọc/ghi tệp, chạy lệnh shell, duyệt trang). Mô hình không bao giờ thấy trực tiếp máy chủ — mỗi lệnh gọi công cụ đều được trung gian bởi Rust.",
        },
        {
          title: "Chuỗi công cụ cục bộ",
          description:
            "Các tệp lệnh Bash, Python và Node.js chạy trong tiến trình con sandbox được vỏ Rust giám sát. Đầu ra truyền ngược qua cùng kênh IPC để UI chat có thể hiển thị stdout và stderr theo thời gian thực mà không cần thăm dò.",
        },
        {
          title: "Agent trình duyệt",
          description:
            "Một tác vụ nền chạy dài điều khiển phiên bản Chromium qua Chrome DevTools Protocol. Nó chụp ảnh chụp nhanh khả năng tiếp cận, chụp ảnh màn hình, nhấp vào phần tử và chạy trong tiến trình riêng để treo trên web không bao giờ đóng băng UI chat.",
        },
        {
          title: "Lưu trữ cục bộ",
          description:
            "SQLite lưu lịch sử trò chuyện, nhật ký chạy agent và tùy chọn cho từng dự án. lược đồ cố tình thu hẹp: một bảng cho mỗi mối quan tâm, bật khóa ngoại, mỗi lần di chuyển được kiểm tra vào. Không có cơ sở dữ liệu mạng và không có lớp đồng bộ.",
        },
      ],
      flow: {
        title: "Điều gì xảy ra khi bạn gửi tin nhắn",
        description:
          "Một lượt chat điển hình trải qua sáu bước được xác định rõ ràng. Mỗi bước được triển khai trong một module duy nhất để lỗi ở một nơi dễ dàng xác định vị trí.",
        steps: [
          {
            title: "1. Chụp",
            description:
              "Tin nhắn của bạn được thêm vào phiên trong bộ nhớ và dòng cuộc trò chuyện được ghi vào SQLite. Đầu vào cũng được phản chiếu vào nhật ký gỡ lỗi trên đĩa để có thể phát lại.",
          },
          {
            title: "2. Lắp ráp ngữ cảnh",
            description:
              "Trình quản lý ngữ cảnh nén các lượt trước thành ba lớp (microcompact, bộ nhớ phiên, compact kế thừa) để các cuộc trò chuyện dài nằm trong cửa sổ ngữ cảnh của mô hình mà không mất trạng thái quan trọng.",
          },
          {
            title: "3. Gọi mô hình",
            description:
              "Claude SDK truyền phản hồi về UI dưới dạng token đến. Lệnh gọi công cụ được phát ra nội tuyến ngay khi mô hình quyết định sử dụng, thay vì ở cuối lượt.",
          },
          {
            title: "4. Phân phối công cụ",
            description:
              "Lệnh gọi công cụ đi qua cầu IPC vào vỏ Rust, nơi thực thi chính sách quyền (chỉ đọc theo mặc định, quyền ghi phải được chọn tham gia) và chạy hoạt động được yêu cầu trong sandbox phù hợp.",
          },
          {
            title: "5. Truyền kết quả",
            description:
              "Kết quả công cụ truyền ngược qua cùng kênh IPC. UI hiển thị chúng theo gia tăng để lệnh shell chạy lâu không đóng băng cuộc trò chuyện.",
          },
          {
            title: "6. Lưu trữ",
            description:
              "Khi mô hình hoàn thành lượt, tin nhắn trợ lý cuối cùng được cam kết vào SQLite và phiên được niêm phong. Tin nhắn người dùng tiếp theo bắt đầu lượt mới nhưng tái sử dụng cùng cửa sổ ngữ cảnh.",
          },
        ],
      },
      security: {
        title: "Mô hình bảo mật",
        description:
          "Ứng dụng desktop không bao giờ gửi dữ liệu của bạn đến máy chủ mà chúng tôi kiểm soát. Lệnh gọi công cụ và lịch sử trò chuyện nằm trên máy của bạn trừ khi bạn chủ động chọn tham gia tính năng yêu cầu mạng (chẳng hạn như lấy URL công khai qua agent trình duyệt). Chính sách quyền được thực thi bằng Rust, không phải JavaScript, nên front end bị xâm phạm không thể đọc tệp tùy ý.",
        items: [
          "Cuộc trò chuyện, tệp và nhật ký công cụ được lưu trữ cục bộ trong SQLite. Không có dữ liệu遥测 nào rời khỏi máy.",
          "Mọi lệnh gọi công cụ đều được kiểm tra quyền bởi Rust. Front end không thể bỏ qua.",
          "Gọi mạng bên ngoài đi qua module đã kiểm toán duy nhất với danh sách trắng tên miền nghiêm ngặt.",
          "Bí mật (khóa API, mã thông báo OAuth) nằm trong chuỗi khóa OS, không bao giờ trong cơ sở dữ liệu hoặc bundle.",
          "Tự động cập nhật được ký; vỏ Tauri từ chối khởi động cập nhật có chữ ký không khớp với khóa phát hành của dự án.",
        ],
      },
      openSource: {
        title: "Xây dựng công khai",
        description:
          "Pipi Shrimp Agent là mã nguồn mở theo giấy phép dự án. Sự cố, yêu cầu kéo và thảo luận thiết kế đều diễn ra trên GitHub. Kiến trúc được ghi lại ở đây là kiến trúc được xuất bản; nếu bạn phát hiện sự khác biệt, đó là lỗi và chúng tôi muốn biết.",
      },
    },
    changelog: {
      title: "Nhật ký thay đổi",
      subtitle: "Cập nhật và cải tiến mới nhất",
      loading: "Đang tải commits...",
      error: "Tải commits thất bại",
      viewOnGithub: "Xem trên GitHub",
      errorTitle: "Không thể tải nhật ký thay đổi",
      errorGeneric: "Đã xảy ra sự cố khi tải các commit mới nhất. Vui lòng thử lại hoặc xem trực tiếp trên GitHub.",
      errorTimeout: "Yêu cầu tới GitHub đã hết thời gian. Vui lòng thử lại sau.",
      errorNetwork: "Không thể kết nối tới GitHub. Kiểm tra kết nối và thử lại.",
      errorRateLimited: "GitHub tạm thời giới hạn yêu cầu. Vui lòng thử lại sau vài phút hoặc xem các commit trực tiếp trên GitHub.",
      empty: "Chưa có commit nào để hiển thị.",
      retry: "Thử lại",
      refreshing: "Đang làm mới...",
      cacheHint: "Danh sách này được làm mới khoảng mỗi {seconds} phút.",
    },
    footer: {
      copyright: "Mọi quyền được bảo lưu.",
      builtWith: "Được xây dựng với",
    },
    notFound: {
      title: "Không tìm thấy trang",
      description:
        "Trang bạn đang tìm không tồn tại hoặc đã được di chuyển. Hãy chọn một trang bên dưới để tiếp tục.",
      goHome: "Về trang chủ",
      seeFeatures: "Xem tính năng",
      readChangelog: "Đọc nhật ký thay đổi",
      openGithub: "Mở GitHub",
    },
  },
};
