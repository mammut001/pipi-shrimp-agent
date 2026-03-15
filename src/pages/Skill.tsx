/**
 * Skill - Skill Market page component
 *
 * Features:
 * - Display 4 core skills in a clean grid
 * - Simple black/gray design (Vercel style)
 */

import { useState, useEffect } from 'react';
import { MainLayout } from '@/layout';
import { useUIStore } from '@/store';
import { readTextFile } from '@tauri-apps/api/fs';

// Core skills only - no categories
const defaultSkills = [
  {
    id: 'pdf',
    name: 'PDF 分析器',
    description: '读取 PDF，提取文本、表格、元数据',
    icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
    skillPath: 'src/skills/pdf/SKILL.md',
  },
  {
    id: 'docx',
    name: 'Word 文档',
    description: '创建和编辑 Word 文档',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    skillPath: 'src/skills/docx/SKILL.md',
  },
  {
    id: 'xlsx',
    name: '数据统计',
    description: '处理 CSV/JSON/Excel，生成报告',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    skillPath: 'src/skills/xlsx/SKILL.md',
  },
  {
    id: 'email',
    name: '邮件发送',
    description: '通过 SMTP 发送邮件',
    icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    skillPath: 'src/skills/email/SKILL.md',
  },
];

/**
 * Skill page component - displays 4 core skills
 */
export function Skill() {
  const { setCurrentView } = useUIStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [skills, setSkills] = useState(defaultSkills);
  const [selectedSkill, setSelectedSkill] = useState<typeof defaultSkills[0] | null>(null);
  const [skillContent, setSkillContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);

  // Custom skill modal state
  const [showCustomSkillModal, setShowCustomSkillModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<typeof defaultSkills[0] | null>(null);
  const [skillForm, setSkillForm] = useState({
    name: '',
    description: '',
    icon: 'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z',
  });

  // Open custom skill modal
  const handleOpenCustomSkillModal = () => {
    setEditingSkill(null);
    setSkillForm({
      name: '',
      description: '',
      icon: 'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z',
    });
    setShowCustomSkillModal(true);
  };

  // Open edit skill modal
  const handleEditSkill = (e: React.MouseEvent, skill: typeof defaultSkills[0]) => {
    e.stopPropagation();
    setEditingSkill(skill);
    setSkillForm({
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
    });
    setShowCustomSkillModal(true);
  };

  // Save skill (create or update)
  const handleSaveSkill = () => {
    if (!skillForm.name.trim() || !skillForm.description.trim()) return;

    if (editingSkill) {
      // Update existing skill
      setSkills(prev => prev.map(s =>
        s.id === editingSkill.id
          ? { ...s, name: skillForm.name, description: skillForm.description, icon: skillForm.icon }
          : s
      ));
      // Update selected skill if it's the one being edited
      if (selectedSkill?.id === editingSkill.id) {
        setSelectedSkill(prev => prev ? { ...prev, name: skillForm.name, description: skillForm.description, icon: skillForm.icon } : null);
      }
    } else {
      // Create new skill
      const newSkill = {
        id: `custom-${Date.now()}`,
        name: skillForm.name,
        description: skillForm.description,
        icon: skillForm.icon,
        skillPath: `${skillForm.name.toLowerCase().replace(/\s+/g, '-')}/SKILL.md`,
      };
      setSkills(prev => [...prev, newSkill]);
    }
    setShowCustomSkillModal(false);
  };

  // Delete skill handler
  const handleDeleteSkill = (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation();
    setSkills(prev => prev.filter(s => s.id !== skillId));
    if (selectedSkill?.id === skillId) {
      setSelectedSkill(null);
    }
  };

  // Load SKILL.md when a skill is selected
  useEffect(() => {
    if (!selectedSkill) {
      setSkillContent('');
      return;
    }

    const loadSkillContent = async () => {
      setLoadingContent(true);
      try {
        // Construct the full path to the SKILL.md file
        const homeDir = await import('@tauri-apps/api/path').then(p => p.homeDir());
        const skillFullPath = `${homeDir}/Library/Application Support/LobsterAI/SKILLs/${selectedSkill.skillPath}`;

        const content = await readTextFile(skillFullPath);
        setSkillContent(content);
      } catch (error) {
        console.error('Failed to load skill content:', error);
        setSkillContent('# 无法加载 SKILL.md\n\n请确保已安装此 skill。');
      } finally {
        setLoadingContent(false);
      }
    };

    loadSkillContent();
  }, [selectedSkill, skills]);

  // Filter skills based on search
  const filteredSkills = skills.filter(skill =>
    skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <MainLayout>
      <div className="flex-1 flex min-h-0 bg-white">
        {/* Skills Grid - Left Panel */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 flex-shrink-0">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentView('chat')}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="返回聊天"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                <h1 className="text-2xl font-bold text-gray-900">Skills</h1>
              </div>

              {/* Add Custom Skill Button */}
              <button
                onClick={handleOpenCustomSkillModal}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                添加自定义 Skill
              </button>
            </div>

            {/* Search Bar */}
            <div className="relative max-w-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 Skill..."
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-gray-700 placeholder-gray-400 text-sm"
              />
            </div>
          </div>

          {/* Skills Grid */}
          <div className="flex-1 overflow-y-auto px-8 pb-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSkills.map(skill => (
                <div
                  key={skill.id}
                  onClick={() => setSelectedSkill(skill)}
                  className={`bg-gray-50 rounded-xl p-5 border transition-all cursor-pointer group relative ${
                    selectedSkill?.id === skill.id
                      ? 'border-gray-900 bg-gray-100'
                      : 'border-gray-200 hover:border-gray-400 hover:bg-gray-100'
                  }`}
                >
                  {/* Edit Button */}
                  <button
                    onClick={(e) => handleEditSkill(e, skill)}
                    className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-blue-100 text-blue-500 transition-all"
                    title="编辑"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>

                  {/* Delete Button */}
                  <button
                    onClick={(e) => handleDeleteSkill(e, skill.id)}
                    className="absolute top-3 right-10 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-100 text-red-500 transition-all"
                    title="删除"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>

                  {/* Skill Icon - Black style */}
                  <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d={skill.icon} />
                    </svg>
                  </div>

                  {/* Skill Name */}
                  <h3 className="font-semibold text-gray-900 mb-1 group-hover:text-gray-700 transition-colors">
                    {skill.name}
                  </h3>

                  {/* Skill Description */}
                  <p className="text-sm text-gray-500">
                    {skill.description}
                  </p>
                </div>
              ))}
            </div>

            {/* Empty State */}
            {filteredSkills.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-8 w-8 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-700 mb-1">未找到</h3>
                <p className="text-gray-500 text-sm">尝试其他搜索词</p>
              </div>
            )}
          </div>
        </div>

        {/* Skill Detail Panel - Right Side */}
        {selectedSkill && (
          <div className="w-[400px] border-l border-gray-200 flex flex-col bg-gray-50 overflow-hidden">
            {/* Panel Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
              <h2 className="font-semibold text-gray-900">{selectedSkill.name}</h2>
              <button
                onClick={() => setSelectedSkill(null)}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* Skill Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingContent ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 bg-white p-4 rounded-lg border border-gray-200 overflow-x-auto">
                    {skillContent}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Custom Skill Modal */}
      {showCustomSkillModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCustomSkillModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[420px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingSkill ? '编辑 Skill' : '添加自定义 Skill'}
              </h3>
              <button
                onClick={() => setShowCustomSkillModal(false)}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* Skill Name */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">名称</label>
              <input
                type="text"
                value={skillForm.name}
                onChange={(e) => setSkillForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="例如：PDF 分析器"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {/* Skill Description */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">描述</label>
              <textarea
                value={skillForm.description}
                onChange={(e) => setSkillForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="例如：读取 PDF，提取文本、表格、元数据"
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Icon Preview */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">图标预览</label>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-900 flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={skillForm.icon} />
                  </svg>
                </div>
                <p className="text-xs text-gray-500">鼠标悬停在技能卡片上可以看到编辑按钮</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowCustomSkillModal(false)}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors font-medium"
              >
                取消
              </button>
              <button
                onClick={handleSaveSkill}
                disabled={!skillForm.name.trim() || !skillForm.description.trim()}
                className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingSkill ? '保存修改' : '添加 Skill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}

export default Skill;
