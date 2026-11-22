import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { TripsPage } from './pages/TripsPage';
import { TripPage } from './pages/TripPage';
import { DestinationPage } from './pages/DestinationPage';
import { PlacePage } from './pages/PlacePage';
import { ActivityPage } from './pages/ActivityPage';
import { ItemsPage } from './pages/ItemsPage';
import { ItemPage } from './pages/ItemPage';
import { SettingsPage } from './pages/SettingsPage';
import { PlacesLibraryPage } from './pages/PlacesLibraryPage';
import { LibraryPlacePage } from './pages/LibraryPlacePage';
import { Empty } from './components/ui';
import { AuthGate } from './auth/AuthGate';
import { SyncIndicator } from './components/SyncIndicator';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  return (
    <HashRouter>
      <ScrollToTop />
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" end>
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
            Packlist
          </NavLink>
          <div className="topbar-right">
            <SyncIndicator />
          <nav className="topnav" aria-label="Main">
            <NavLink to="/" end>
              Trips
            </NavLink>
            <NavLink to="/library/places">Places</NavLink>
            <NavLink to="/items">Items</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </nav>
          </div>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<TripsPage />} />
          <Route path="/trips/:tripId" element={<TripPage />} />
          <Route path="/destinations/:destinationId" element={<DestinationPage />} />
          <Route path="/places/:placeId" element={<PlacePage />} />
          <Route path="/activities/:activityId" element={<ActivityPage />} />
          <Route path="/library/places" element={<PlacesLibraryPage />} />
          <Route path="/library/places/:libraryId" element={<LibraryPlacePage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/items/:itemId" element={<ItemPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Empty icon="🧭" title="Page not found" />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end>
          <span aria-hidden>🧳</span>Trips
        </NavLink>
        <NavLink to="/library/places">
          <span aria-hidden>📍</span>Places
        </NavLink>
        <NavLink to="/items">
          <span aria-hidden>👕</span>Items
        </NavLink>
        <NavLink to="/settings">
          <span aria-hidden>⚙️</span>Settings
        </NavLink>
      </nav>
    </HashRouter>
  );
}
