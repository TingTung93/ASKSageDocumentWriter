import { describe, expect, it, vi } from 'vitest';
import { downloadJsonExport } from './diagnostic_json';

describe('diagnostic JSON downloads', () => {
  it('creates a content-bearing JSON download and revokes its object URL', () => {
    vi.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn() });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadJsonExport('support.json', { disclosure: 'Contains document content' });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    vi.useRealTimers();
  });
});
