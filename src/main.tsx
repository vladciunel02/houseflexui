import { createRoot } from 'react-dom/client';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/700.css';
import './styles/tokens.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
