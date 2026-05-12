import { AGENT_TEMPLATES } from '../workflow/templates/agentTemplates';

describe('workflow templates', () => {
  it('ensures every template exposes the required registry fields', () => {
    for (const template of AGENT_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.task).toBeTruthy();
      expect(template.soulPrompt).toBeTruthy();
      expect(template.execution).toBeDefined();
      expect(template.recommendedRole).toBeTruthy();
      if (template.recommendedRole !== 'goal-evaluator') {
        expect(template.requiredOutputMarkers?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});