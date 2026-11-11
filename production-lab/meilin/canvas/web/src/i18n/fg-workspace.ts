import type { AppLocale } from "./locales";

const zh = {
    home: "超级创作", stories: "故事与项目", drama: "短剧 Agent", advertising: "广告工作台",
    meilin: "美林 · 超级导演", canvas: "超级自由画布", audio: "音频设置区", resources: "资源与工具",
    company: "公司创作空间", brand: "FG超级工作台", back: "返回 FG 工作区", inspirations: "灵感大厅",
    prompt: "输入你的镜头、画面或故事。也可以添加参考图开始创作", references: "参考内容", generating: "生成中",
    recommended: "每日推荐", newest: "最近更新",
};

export const fgWorkspaceMessages: Record<AppLocale, { [Key in keyof typeof zh]: string }> = {
    "zh-CN": zh,
    "en-US": {
        home: "Create", stories: "Stories & projects", drama: "Short Drama Agent", advertising: "Ad Studio",
        meilin: "Meilin · AI Director", canvas: "Canvas", audio: "Audio settings", resources: "Resources & tools",
        company: "Company workspace", brand: "FG Studio", back: "Back to FG workspace", inspirations: "Inspiration gallery",
        prompt: "Describe a shot, scene, or story. You can also add reference images.", references: "References", generating: "Generating…",
        recommended: "Daily picks", newest: "Recently updated",
    },
    "fr-FR": {
        home: "Créer", stories: "Histoires et projets", drama: "Agent de séries courtes", advertising: "Studio publicitaire",
        meilin: "Meilin · Réalisation IA", canvas: "Canevas", audio: "Paramètres audio", resources: "Ressources et outils",
        company: "Espace de l’entreprise", brand: "Studio FG", back: "Retour à l’espace FG", inspirations: "Galerie d’inspiration",
        prompt: "Décrivez un plan, une scène ou une histoire. Vous pouvez ajouter des images de référence.", references: "Références", generating: "Génération…",
        recommended: "Sélection du jour", newest: "Mises à jour récentes",
    },
    "de-DE": {
        home: "Erstellen", stories: "Geschichten und Projekte", drama: "Agent für Kurzserien", advertising: "Werbestudio",
        meilin: "Meilin · KI-Regie", canvas: "Leinwand", audio: "Audioeinstellungen", resources: "Ressourcen und Werkzeuge",
        company: "Unternehmensarbeitsbereich", brand: "FG Studio", back: "Zurück zum FG-Arbeitsbereich", inspirations: "Inspirationsgalerie",
        prompt: "Beschreibe eine Einstellung, Szene oder Geschichte. Du kannst auch Referenzbilder hinzufügen.", references: "Referenzen", generating: "Wird generiert…",
        recommended: "Tagestipps", newest: "Zuletzt aktualisiert",
    },
    "ja-JP": {
        home: "制作", stories: "ストーリーとプロジェクト", drama: "短編ドラマ Agent", advertising: "広告スタジオ",
        meilin: "Meilin · AI 監督", canvas: "キャンバス", audio: "音声設定", resources: "素材とツール",
        company: "社内ワークスペース", brand: "FG スタジオ", back: "FG ワークスペースへ戻る", inspirations: "アイデアギャラリー",
        prompt: "ショット、シーン、ストーリーを入力してください。参考画像も追加できます。", references: "参考素材", generating: "生成中…",
        recommended: "今日のおすすめ", newest: "最近の更新",
    },
    "ko-KR": {
        home: "제작", stories: "스토리와 프로젝트", drama: "숏드라마 에이전트", advertising: "광고 스튜디오",
        meilin: "Meilin · AI 감독", canvas: "캔버스", audio: "오디오 설정", resources: "자료 및 도구",
        company: "회사 작업 공간", brand: "FG 스튜디오", back: "FG 작업 공간으로 돌아가기", inspirations: "아이디어 갤러리",
        prompt: "쇼트, 장면 또는 이야기를 설명하세요. 참고 이미지도 추가할 수 있습니다.", references: "참고 자료", generating: "생성 중…",
        recommended: "오늘의 추천", newest: "최근 업데이트",
    },
};
