import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ProjectDetailRedirect } from './App';

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="pathname">{location.pathname}</output>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

describe('project route cutover', () => {
  it('redirects the historical project route to V2', () => {
    render(
      <MemoryRouter initialEntries={['/sentinel', '/projects/project-123']} initialIndex={1}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailRedirect />} />
          <Route path="/v2/:id" element={<LocationProbe />} />
          <Route path="/sentinel" element={<output>Sentinel</output>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('pathname')).toHaveTextContent('/v2/project-123');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Sentinel')).toBeInTheDocument();
  });
});
