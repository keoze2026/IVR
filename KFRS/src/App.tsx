import { Header } from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import { Hero } from "./components/home/Hero";
import { AboutSection } from "./components/about/AboutSection";
import { DisciplinesSection } from "./components/disciplines/DisciplinesSection";
import { LeadershipSection } from "./components/leadership/LeadershipSection";
import { EventsSection } from "./components/events/EventsSection";
import { ClubsSection } from "./components/clubs/ClubsSection";
import { ContactSection } from "./components/contact/ContactSection";

function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans selection:bg-kenya-red selection:text-white">
      <Header />
      
      <main className="flex-grow">
        <Hero />
        <AboutSection />
        <DisciplinesSection />
        <LeadershipSection />
        <EventsSection />
        <ClubsSection />
        <ContactSection />
      </main>

      <Footer />
    </div>
  );
}

export default App;
