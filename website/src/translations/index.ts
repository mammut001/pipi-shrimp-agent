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
    // Navigation
    nav: {
      home: "Home",
      about: "About",
      features: "Features",
      changelog: "Changelog",
    },
    // Header
    header: {
      download: "Download",
      github: "GitHub",
    },
    // Hero Section
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "Your intelligent AI assistant for macOS",
      description: "A powerful, elegant AI assistant that helps you get things done. Built for developers and power users.",
      downloadArm: "Download for Apple Silicon",
      downloadIntel: "Download for Intel",
      version: "Version",
    },
    // About Page
    about: {
      title: "About",
      description: "Pipi Shrimp Agent is a modern AI assistant designed for macOS. It combines the power of large language models with a beautiful, intuitive interface.",
      features: {
        title: "Key Features",
        ai: {
          title: "AI-Powered",
          description: "Powered by advanced large language models for intelligent conversations.",
        },
        privacy: {
          title: "Privacy First",
          description: "Your data stays on your device. No cloud processing of personal information.",
        },
        fast: {
          title: "Lightning Fast",
          description: "Optimized for performance with native macOS integration.",
        },
      },
    },
    // Features Page
    features: {
      title: "Features",
      subtitle: "Everything you need to boost your productivity",
      list: [
        {
          title: "Intelligent Conversations",
          description: "Natural, contextual AI interactions that understand your intent.",
        },
        {
          title: "Code Assistance",
          description: "Get help with coding tasks, from debugging to refactoring.",
        },
        {
          title: "Quick Access",
          description: "Launch via menu bar or keyboard shortcuts for instant assistance.",
        },
        {
          title: "Customizable",
          description: "Tailor the assistant to your workflow with personalized settings.",
        },
        {
          title: "Multi-language",
          description: "Support for 5 languages: English, French, Chinese, Korean, Vietnamese.",
        },
        {
          title: "Regular Updates",
          description: "Continuous improvements with frequent feature releases.",
        },
      ],
    },
    // Changelog Page
    changelog: {
      title: "Changelog",
      subtitle: "Latest updates and improvements",
      loading: "Loading commits...",
      error: "Failed to load commits",
      viewOnGithub: "View on GitHub",
    },
    // Footer
    footer: {
      copyright: "All rights reserved.",
      builtWith: "Built with",
    },
  },
  fr: {
    // Navigation
    nav: {
      home: "Accueil",
      about: "À propos",
      features: "Fonctionnalités",
      changelog: "Journal des modifications",
    },
    // Header
    header: {
      download: "Télécharger",
      github: "GitHub",
    },
    // Hero Section
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "Votre assistant IA intelligent pour macOS",
      description: "Un assistant IA puissant et élégant qui vous aide à accomplir vos tâches. Conçu pour les développeurs et les utilisateurs avancés.",
      downloadArm: "Télécharger pour Apple Silicon",
      downloadIntel: "Télécharger pour Intel",
      version: "Version",
    },
    // About Page
    about: {
      title: "À propos",
      description: "Pipi Shrimp Agent est un assistant IA moderne conçu pour macOS. Il combine la puissance des grands modèles de langage avec une belle interface intuitive.",
      features: {
        title: "Fonctionnalités clés",
        ai: {
          title: "Alimenté par l'IA",
          description: "Propulsé par des modèles de langage avancés pour des conversations intelligentes.",
        },
        privacy: {
          title: "Confidentialité d'abord",
          description: "Vos données restent sur votre appareil. Pas de traitement cloud des informations personnelles.",
        },
        fast: {
          title: "Éclair rapide",
          description: "Optimisé pour les performances avec une intégration native macOS.",
        },
      },
    },
    // Features Page
    features: {
      title: "Fonctionnalités",
      subtitle: "Tout ce dont vous avez besoin pour booster votre productivité",
      list: [
        {
          title: "Conversations intelligentes",
          description: "Interactions IA naturelles et contextuelles qui comprennent vos intentions.",
        },
        {
          title: "Assistance au code",
          description: "Obtenez de l'aide pour les tâches de codage, du débogage au refactoring.",
        },
        {
          title: "Accès rapide",
          description: "Lancez via la barre de menu ou les raccourcis clavier pour une assistance instantanée.",
        },
        {
          title: "Personnalisable",
          description: "Adaptez l'assistant à votre flux de travail avec des paramètres personnalisés.",
        },
        {
          title: "Multilingue",
          description: "Support pour 5 langues : anglais, français, chinois, coréen, vietnamien.",
        },
        {
          title: "Mises à jour régulières",
          description: "Améliorations continues avec des versions de fonctionnalités fréquentes.",
        },
      ],
    },
    // Changelog Page
    changelog: {
      title: "Journal des modifications",
      subtitle: "Dernières mises à jour et améliorations",
      loading: "Chargement des commits...",
      error: "Échec du chargement des commits",
      viewOnGithub: "Voir sur GitHub",
    },
    // Footer
    footer: {
      copyright: "Tous droits réservés.",
      builtWith: "Construit avec",
    },
  },
  zh: {
    // Navigation
    nav: {
      home: "首页",
      about: "关于",
      features: "功能",
      changelog: "更新日志",
    },
    // Header
    header: {
      download: "下载",
      github: "GitHub",
    },
    // Hero Section
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "您的智能 macOS AI 助手",
      description: "一个强大、优雅的 AI 助手，帮助您完成任务。为开发者和高级用户打造。",
      downloadArm: "下载 Apple Silicon 版",
      downloadIntel: "下载 Intel 版",
      version: "版本",
    },
    // About Page
    about: {
      title: "关于",
      description: "Pipi Shrimp Agent 是专为 macOS 设计的现代 AI 助手。它将大型语言模型的强大能力与美观、直观的界面相结合。",
      features: {
        title: "核心功能",
        ai: {
          title: "AI 驱动",
          description: "由先进的大型语言模型驱动，进行智能对话。",
        },
        privacy: {
          title: "隐私优先",
          description: "您的数据留在设备上。不在云端处理个人信息。",
        },
        fast: {
          title: "闪电般快速",
          description: "针对性能优化，原生 macOS 集成。",
        },
      },
    },
    // Features Page
    features: {
      title: "功能",
      subtitle: "提升生产力所需的一切",
      list: [
        {
          title: "智能对话",
          description: "自然、情境化的 AI 交互，理解您的意图。",
        },
        {
          title: "代码助手",
          description: "获取编码任务帮助，从调试到重构。",
        },
        {
          title: "快速访问",
          description: "通过菜单栏或键盘快捷键启动，即时获得帮助。",
        },
        {
          title: "可定制",
          description: "通过个性化设置定制助手以适应您的工作流程。",
        },
        {
          title: "多语言",
          description: "支持 5 种语言：英语、法语、中文、韩语、越南语。",
        },
        {
          title: "定期更新",
          description: "持续改进，频繁发布新功能。",
        },
      ],
    },
    // Changelog Page
    changelog: {
      title: "更新日志",
      subtitle: "最新更新和改进",
      loading: "加载提交中...",
      error: "加载提交失败",
      viewOnGithub: "在 GitHub 上查看",
    },
    // Footer
    footer: {
      copyright: "版权所有。",
      builtWith: "由",
    },
  },
  ko: {
    // Navigation
    nav: {
      home: "홈",
      about: "정보",
      features: "기능",
      changelog: "변경 로그",
    },
    // Header
    header: {
      download: "다운로드",
      github: "GitHub",
    },
    // Hero Section
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "macOS용 지능형 AI 어시스턴트",
      description: "작업을 완료하도록 도와주는 강력하고 우아한 AI 어시스턴트. 개발자와 전력 사용자를 위해 구축되었습니다.",
      downloadArm: "Apple Silicon용 다운로드",
      downloadIntel: "Intel용 다운로드",
      version: "버전",
    },
    // About Page
    about: {
      title: "정보",
      description: "Pipi Shrimp Agent는 macOS를 위해 설계된 현대적인 AI 어시스턴트입니다. 대규모 언어 모델의 힘을 아름다운 직관적인 인터페이스와 결합합니다.",
      features: {
        title: "주요 기능",
        ai: {
          title: "AI 구동",
          description: "지능적인 대화를 위한 고급 대규모 언어 모델로 구동됩니다.",
        },
        privacy: {
          title: "개인정보 보호 우선",
          description: "데이터는 기기에 남아 있습니다. 개인 정보의 클라우드 처리 없음.",
        },
        fast: {
          title: "번개처럼 빠름",
          description: "기본 macOS 통합으로 성능에 최적화되었습니다.",
        },
      },
    },
    // Features Page
    features: {
      title: "기능",
      subtitle: "생산성을 높이기 위해 필요한 모든 것",
      list: [
        {
          title: "지능형 대화",
          description: "의도를 이해하는 자연스러운 상황별 AI 상호작용.",
        },
        {
          title: "코드 지원",
          description: "디버깅부터 리팩토링까지 코딩 작업에 대한 도움말을 받으세요.",
        },
        {
          title: "빠른 액세스",
          description: "메뉴 모음 또는 키보드 단축키로 실행하여 즉각적인 지원을 받으세요.",
        },
        {
          title: "사용자 정의 가능",
          description: "개인화된 설정으로 워크플로에 맞게 어시스턴트를 조정하세요.",
        },
        {
          title: "다국어 지원",
          description: "5개 언어 지원: 영어, 프랑스어, 중국어, 한국어, 베ietnam어.",
        },
        {
          title: "정기 업데이트",
          description: "자주적인 기능 출시로 지속적인 개선.",
        },
      ],
    },
    // Changelog Page
    changelog: {
      title: "변경 로그",
      subtitle: "최신 업데이트 및 개선 사항",
      loading: "커밋 로드 중...",
      error: "커밋 로드 실패",
      viewOnGithub: "GitHub에서 보기",
    },
    // Footer
    footer: {
      copyright: "모든 권리 보유.",
      builtWith: "만든 곳",
    },
  },
  vi: {
    // Navigation
    nav: {
      home: "Trang chủ",
      about: "Giới thiệu",
      features: "Tính năng",
      changelog: "Nhật ký thay đổi",
    },
    // Header
    header: {
      download: "Tải xuống",
      github: "GitHub",
    },
    // Hero Section
    hero: {
      title: "Pipi Shrimp Agent",
      subtitle: "Trợ lý AI thông minh cho macOS",
      description: "Một trợ lý AI mạnh mẽ, thanh lịch giúp bạn hoàn thành công việc. Được xây dựng cho nhà phát triển và người dùng nâng cao.",
      downloadArm: "Tải cho Apple Silicon",
      downloadIntel: "Tải cho Intel",
      version: "Phiên bản",
    },
    // About Page
    about: {
      title: "Giới thiệu",
      description: "Pipi Shrimp Agent là một trợ lý AI hiện đại được thiết kế cho macOS. Nó kết hợp sức mạnh của các mô hình ngôn ngữ lớn với giao diện đẹp mắt và trực quan.",
      features: {
        title: "Tính năng chính",
        ai: {
          title: "Được cấp năng lượng bởi AI",
          description: "Được cung cấp bởi các mô hình ngôn ngữ lớn tiên tiến cho các cuộc trò chuyện thông minh.",
        },
        privacy: {
          title: "Quyền riêng tư trước tiên",
          description: "Dữ liệu của bạn nằm trên thiết bị của bạn. Không xử lý đám mây cho thông tin cá nhân.",
        },
        fast: {
          title: "Nhanh như chớp",
          description: "Được tối ưu hóa cho hiệu suất với tích hợp macOS gốc.",
        },
      },
    },
    // Features Page
    features: {
      title: "Tính năng",
      subtitle: "Mọi thứ bạn cần để tăng năng suất",
      list: [
        {
          title: "Cuộc trò chuyện thông minh",
          description: "Tương tác AI tự nhiên, theo ngữ cảnh hiểu ý định của bạn.",
        },
        {
          title: "Hỗ trợ mã",
          description: "Nhận hỗ trợ cho các tác vụ lập trình, từ gỡ lỗi đến tái cấu trúc.",
        },
        {
          title: "Truy cập nhanh",
          description: "Khởi chạy qua thanh menu hoặc phím tắt để được hỗ trợ ngay lập tức.",
        },
        {
          title: "Tùy chỉnh được",
          description: "Điều chỉnh trợ lý theo quy trình làm việc của bạn với cài đặt cá nhân hóa.",
        },
        {
          title: "Đa ngôn ngữ",
          description: "Hỗ trợ 5 ngôn ngữ: Anh, Pháp, Trung, Hàn, Việt.",
        },
        {
          title: "Cập nhật thường xuyên",
          description: "Cải tiến liên tục với các bản phát hành tính năng thường xuyên.",
        },
      ],
    },
    // Changelog Page
    changelog: {
      title: "Nhật ký thay đổi",
      subtitle: "Cập nhật và cải tiến mới nhất",
      loading: "Đang tải commits...",
      error: "Tải commits thất bại",
      viewOnGithub: "Xem trên GitHub",
    },
    // Footer
    footer: {
      copyright: "Mọi quyền được bảo lưu.",
      builtWith: "Được xây dựng với",
    },
  },
};
