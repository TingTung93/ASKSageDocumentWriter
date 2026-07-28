import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V2Home } from './V2Home';

const { createProjectMock, liveQueryMock } = vi.hoisted(() => ({
  createProjectMock: vi.fn(),
  liveQueryMock: vi.fn(),
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: liveQueryMock,
}));

vi.mock('../../lib/project/helpers', () => ({
  createProject: createProjectMock,
}));

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

const project = {
  id: 'project-1',
  name: 'Acquisition package',
  description: 'Draft the requirement.',
  template_ids: ['template-1'],
  reference_dataset_names: [],
  shared_inputs: {},
  mode: 'template',
  model_overrides: {},
  live_search: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const template = {
  id: 'template-1',
  name: 'PWS template',
  filename: 'pws.docx',
  ingested_at: '2026-01-01T00:00:00Z',
  docx_bytes: new Blob(),
  schema_json: { sections: [{ id: 'scope' }] },
};

function renderHome(props: { onOpenIngest?: () => void } = {}) {
  return render(
    <MemoryRouter initialEntries={['/v2']}>
      <V2Home {...props} />
      <Location />
    </MemoryRouter>,
  );
}

describe('V2Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveQueryMock.mockImplementation((query: () => unknown) =>
      query.toString().includes('db.projects') ? [project] : [template],
    );
  });

  it('lists, searches, and opens saved projects in V2', () => {
    renderHome();
    expect(screen.getByText('Acquisition package')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search projects…'), {
      target: { value: 'missing' },
    });
    expect(screen.getByText(/No projects match/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search projects…'), {
      target: { value: 'Acquisition' },
    });
    fireEvent.click(screen.getByText('Acquisition package'));
    expect(screen.getByTestId('location')).toHaveTextContent('/v2/project-1');
  });

  it('creates a template project using the shared project helper', async () => {
    createProjectMock.mockResolvedValue({ ...project, id: 'new-project' });
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'New PWS' } });
    fireEvent.change(screen.getByLabelText('Purpose and context'), { target: { value: 'A useful description' } });
    fireEvent.click(screen.getByText('PWS template'));
    fireEvent.click(screen.getByRole('button', { name: 'Create and open project' }));

    await waitFor(() => expect(createProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New PWS',
      description: 'A useful description',
      mode: 'template',
      template_ids: ['template-1'],
    })));
    expect(screen.getByTestId('location')).toHaveTextContent('/v2/new-project');
  });

  it('offers template ingestion when the library is empty', () => {
    liveQueryMock.mockImplementation(() => []);
    const onOpenIngest = vi.fn();
    renderHome({ onOpenIngest });

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload DOCX template' }));
    expect(onOpenIngest).toHaveBeenCalledOnce();
  });
});
