import { Routes, Route } from 'react-router-dom';
import Footer from './components/Footer';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Search from './pages/Search';
import Watch from './pages/Watch';

export default function App() {
  return (
    <div className="app flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 pt-[64px] lg:pt-[76px]">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
