import { useState, useEffect } from "react";
import { Menu, X, Phone, Mail, MapPin } from "lucide-react";
import { KFRSLogo } from "../common/KFRSLogo";
import { cn } from "../../utils";

const NAV_LINKS = [
  { name: "Home", href: "#home" },
  { name: "About Us", href: "#about" },
  { name: "Disciplines", href: "#disciplines" },
  { name: "Leadership", href: "#leadership" },
  { name: "Events", href: "#events" },
  { name: "Clubs", href: "#clubs" },
  { name: "Contact", href: "#contact" },
];

export function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 transition-all duration-300">
      {/* Top Bar - Hidden on small screens */}
      <div className="hidden md:flex bg-kenya-black text-white/90 text-xs py-2 px-4 md:px-8 justify-between items-center">
        <div className="flex items-center gap-6">
          <a href="tel:+254716070707" className="flex items-center gap-2 hover:text-kenya-gold transition-colors">
            <Phone size={14} />
            +254 716 070707
          </a>
          <a href="mailto:admin@kfrs.or.ke" className="flex items-center gap-2 hover:text-kenya-gold transition-colors">
            <Mail size={14} />
            admin@kfrs.or.ke
          </a>
          <span className="flex items-center gap-2">
            <MapPin size={14} />
            Nairobi, Kenya
          </span>
        </div>
        <div className="flex items-center gap-4 font-semibold text-kenya-gold">
          Official National Governing Body
        </div>
      </div>

      {/* Main Navbar */}
      <div className={cn(
        "bg-white/95 backdrop-blur-md border-b border-gray-200 transition-all duration-300",
        isScrolled ? "shadow-md py-2" : "py-4"
      )}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <a href="#home" className="focus:outline-none focus:ring-2 focus:ring-kenya-red rounded-lg">
            <KFRSLogo />
          </a>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8">
            <ul className="flex items-center gap-6">
              {NAV_LINKS.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-sm font-medium text-gray-700 hover:text-kenya-red transition-colors relative group"
                  >
                    {link.name}
                    <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-kenya-red transition-all group-hover:w-full" />
                  </a>
                </li>
              ))}
            </ul>
            <a
              href="#contact"
              className="bg-kenya-red hover:bg-kenya-red/90 text-white px-5 py-2 rounded-md font-semibold text-sm transition-colors shadow-sm"
            >
              Join a Club
            </a>
          </nav>

          {/* Mobile Menu Toggle */}
          <button
            className="lg:hidden p-2 text-gray-700 hover:text-kenya-red transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 right-0 bg-white shadow-xl border-t border-gray-100 max-h-[calc(100vh-80px)] overflow-y-auto">
          <nav className="flex flex-col p-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="py-3 px-4 text-base font-medium text-gray-800 hover:bg-gray-50 hover:text-kenya-red border-b border-gray-100 transition-colors"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {link.name}
              </a>
            ))}
            <a
              href="#contact"
              className="mt-6 bg-kenya-red text-white text-center px-5 py-3 rounded-md font-semibold transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Join a Club
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
