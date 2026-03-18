export type TranslationKeys = {
  nav: {
    home: string;
    about: string;
    features: string;
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
  };
  features: {
    title: string;
    subtitle: string;
    list: Array<{
      title: string;
      description: string;
    }>;
  };
  changelog: {
    title: string;
    subtitle: string;
    loading: string;
    error: string;
    viewOnGithub: string;
  };
  footer: {
    copyright: string;
    builtWith: string;
  };
};

export type Language = "en" | "fr" | "zh" | "ko" | "vi";

export const translations: Record<Language, TranslationKeys> = {
  en: {
    nav: {
      home: "Home",
      about: "About",
      features: "Features",
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
    },
    features: {
      title: "Features",
      subtitle: "Everything you need to boost your productivity",
      list: [
        {
          title: "Reasoning UI (Thinking)",
          description: "Real-time AI 'Thinking' process visualization. See the logic behind every answer with collapsible reasoning blocks.",
        },
        {
          title: "Advanced Search (Ripgrep)",
          description: "High-speed codebase search using integrated ripgrep. Support for regex, glob patterns, and recursive filtering.",
        },
        {
          title: "Claude-Style Sidebar",
          description: "Redesigned premium sidebar with collapsible sections for Progress, Working Folders, and Context.",
        },
        {
          title: "Chrome Connector",
          description: "Direct browser integration allowing the agent to interact with web pages and automate workflows.",
        },
        {
          title: "Local Code Execution",
          description: "Execute Bash, Python, and Node.js scripts locally directly from the AI prompt.",
        },
        {
          title: "Advanced Document Rendering",
          description: "Integrates the Typst engine for real-time rendering of high-quality SVG/PDF layouts.",
        },
      ],
    },
    changelog: {
      title: "Changelog",
      subtitle: "Latest updates and improvements",
      loading: "Loading commits...",
      error: "Failed to load commits",
      viewOnGithub: "View on GitHub",
    },
    footer: {
      copyright: "All rights reserved.",
      builtWith: "Built with",
    },
  },
  fr: {
    nav: {
      home: "Accueil",
      about: "À propos",
      features: "Fonctionnalités",
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
    },
    features: {
      title: "Fonctionnalités",
      subtitle: "Tout ce dont vous avez besoin pour booster votre productivité",
      list: [
        {
          title: "Exécution de code local",
          description: "Exécutez des scripts Bash, Python et Node.js localement directement depuis l'invite IA.",
        },
        {
          title: "Rendu de document avancé",
          description: "Intègre exclusivement le moteur Typst pour le rendu en temps réel de mises en page SVG/PDF de haute qualité.",
        },
        {
          title: "Système de flux de travail",
          description: "Gestion flexible des tâches pour automatiser les opérations complexes en plusieurs étapes.",
        },
        {
          title: "Contexte au niveau du projet",
          description: "Gère intelligemment l'historique des conversations pour différents projets soutenu par une base de données SQLite locale.",
        },
        {
          title: "Opérations de fichiers et web",
          description: "Puissantes capacités de gestion de fichiers locaux et navigation web intégrée.",
        },
        {
          title: "Plugins de compétences riches",
          description: "Composants utilitaires intégrés et prêts à l'emploi tels que l'analyse PDF, le traitement Excel et l'extraction Docx.",
        },
      ],
    },
    changelog: {
      title: "Journal des modifications",
      subtitle: "Dernières mises à jour et améliorations",
      loading: "Chargement des commits...",
      error: "Échec du chargement des commits",
      viewOnGithub: "Voir sur GitHub",
    },
    footer: {
      copyright: "Tous droits réservés.",
      builtWith: "Construit avec",
    },
  },
  zh: {
    nav: {
      home: "首页",
      about: "关于",
      features: "功能",
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
          description: "深度集成 Claude SDK，支持实时的 DeepSeek 风格“思考”过程 (Reasoning) 和强大的工具调用能力。",
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
    },
    features: {
      title: "功能",
      subtitle: "提升生产力所需的一切",
      list: [
        {
          title: "推理 UI (Thinking)",
          description: "实时的 AI “思考”过程可视化。通过可折叠的推理块，查看每个回答背后的逻辑。",
        },
        {
          title: "高级搜索 (Ripgrep)",
          description: "集成 ripgrep 的高速代码库搜索。支持正则表达式、Glob 模式和递归过滤。",
        },
        {
          title: "Claude 风格侧边栏",
          description: "重新设计的高级侧边栏，包含进度、工作文件夹和上下文的可折叠部分。",
        },
        {
          title: "Chrome 插件连接器",
          description: "直接的浏览器集成，允许 Agent 与网页交互并自动执行工作流。",
        },
        {
          title: "本地代码执行",
          description: "在本地直接执行 Bash, Python, 和 Node.js 脚本。",
        },
        {
          title: "高级文档渲染",
          description: "集成 Typst 引擎，支持实时渲染高质量 SVG/PDF 排版。",
        },
      ],
    },
    changelog: {
      title: "更新日志",
      subtitle: "最新更新和改进",
      loading: "加载提交中...",
      error: "加载提交失败",
      viewOnGithub: "在 GitHub 上查看",
    },
    footer: {
      copyright: "版权所有。",
      builtWith: "由",
    },
  },
  ko: {
    nav: {
      home: "홈",
      about: "정보",
      features: "기능",
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
    },
    features: {
      title: "기능",
      subtitle: "생산성을 높이기 위해 필요한 모든 것",
      list: [
        {
          title: "로컬 코드 실행",
          description: "AI 프롬프트에서 직접 Bash, Python 및 Node.js 스크립트를 로컬에서 실행합니다.",
        },
        {
          title: "고급 문서 렌더링",
          description: "고품질 SVG/PDF 레이아웃의 실시간 렌더링을 위해 Typst 엔진을 독점적으로 통합합니다.",
        },
        {
          title: "워크플로 시스템",
          description: "다단계 복잡한 작업을 자동화하기 위한 유연한 스트림 기반 작업 관리.",
        },
        {
          title: "프로젝트 수준 컨텍스트",
          description: "로컬 SQLite 데이터베이스를 기반으로 다양한 프로젝트의 대화 기록을 지능적으로 관리합니다.",
        },
        {
          title: "파일 및 웹 작업",
          description: "강력한 로컬 파일 관리 기능과 통합된 웹 브라우징 및 자동화.",
        },
        {
          title: "풍부한 기술 플러그인",
          description: "PDF 분석, Excel 처리 및 Docx 추출과 같은 기본 유틸리티 구성 요소 내장.",
        },
      ],
    },
    changelog: {
      title: "변경 로그",
      subtitle: "최신 업데이트 및 개선 사항",
      loading: "커밋 로드 중...",
      error: "커밋 로드 실패",
      viewOnGithub: "GitHub에서 보기",
    },
    footer: {
      copyright: "모든 권리 보유.",
      builtWith: "만든 곳",
    },
  },
  vi: {
    nav: {
      home: "Trang chủ",
      about: "Giới thiệu",
      features: "Tính năng",
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
    },
    features: {
      title: "Tính năng",
      subtitle: "Mọi thứ bạn cần để tăng năng suất",
      list: [
        {
          title: "Thực thi mã cục bộ",
          description: "Thực thi các tệp lệnh Bash, Python và Node.js cục bộ trực tiếp từ lời nhắc AI.",
        },
        {
          title: "Kết xuất tài liệu nâng cao",
          description: "Tích hợp độc quyền công cụ Typst để kết xuất bố cục SVG/PDF chất lượng cao theo thời gian thực.",
        },
        {
          title: "Hệ thống quy trình làm việc",
          description: "Quản lý tác vụ dựa trên luồng linh hoạt để tự động hóa các thao tác phức tạp nhiều bước.",
        },
        {
          title: "Bối cảnh cấp dự án",
          description: "Quản lý thông minh lịch sử cuộc trò chuyện cho các dự án khác nhau được hỗ trợ bởi cơ sở dữ liệu SQLite cục bộ.",
        },
        {
          title: "Hoạt động tệp & web",
          description: "Khả năng quản lý tệp cục bộ mạnh mẽ và duyệt web và tự động hóa tích hợp.",
        },
        {
          title: "Plugin kỹ năng phong phú",
          description: "Các thành phần tiện ích tích hợp, sẵn sàng sử dụng như phân tích PDF, xử lý Excel và trích xuất Docx.",
        },
      ],
    },
    changelog: {
      title: "Nhật ký thay đổi",
      subtitle: "Cập nhật và cải tiến mới nhất",
      loading: "Đang tải commits...",
      error: "Tải commits thất bại",
      viewOnGithub: "Xem trên GitHub",
    },
    footer: {
      copyright: "Mọi quyền được bảo lưu.",
      builtWith: "Được xây dựng với",
    },
  },
};
