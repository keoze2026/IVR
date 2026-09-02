import { KFRSLogo } from "../common/KFRSLogo";
import { Mail, Phone, MapPin, Globe, MessageCircle, Video, Hash } from "lucide-react";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-kenya-black text-gray-300 pt-16 pb-8 border-t-4 border-kenya-red">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          {/* Brand Col */}
          <div className="space-y-6">
            <KFRSLogo variant="white" />
            <p className="text-sm text-gray-400 leading-relaxed text-balance">
              The official national governing body for all roller sports disciplines in Kenya. We are dedicated to promoting, managing, and supervising roller sports from grassroots to elite levels.
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-kenya-red transition-colors text-white">
                <Globe size={18} />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-kenya-red transition-colors text-white">
                <MessageCircle size={18} />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-kenya-red transition-colors text-white">
                <Hash size={18} />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-kenya-red transition-colors text-white">
                <Video size={18} />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold text-lg mb-6 flex items-center gap-2">
              <span className="w-4 h-1 bg-kenya-green rounded-full"></span>
              Quick Links
            </h3>
            <ul className="space-y-3 text-sm">
              <li><a href="#about" className="hover:text-kenya-gold transition-colors">About KFRS</a></li>
              <li><a href="#disciplines" className="hover:text-kenya-gold transition-colors">Roller Disciplines</a></li>
              <li><a href="#leadership" className="hover:text-kenya-gold transition-colors">Leadership & Governance</a></li>
              <li><a href="#events" className="hover:text-kenya-gold transition-colors">National Calendar</a></li>
              <li><a href="#clubs" className="hover:text-kenya-gold transition-colors">Find a Club</a></li>
            </ul>
          </div>

          {/* Disciplines */}
          <div>
            <h3 className="text-white font-semibold text-lg mb-6 flex items-center gap-2">
              <span className="w-4 h-1 bg-kenya-red rounded-full"></span>
              Disciplines
            </h3>
            <ul className="space-y-3 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Speed Skating</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Inline Freestyle</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Inline Hockey</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Roller Derby</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Artistic Skating</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-white font-semibold text-lg mb-6 flex items-center gap-2">
              <span className="w-4 h-1 bg-white rounded-full"></span>
              Contact Office
            </h3>
            <ul className="space-y-4 text-sm">
              <li className="flex items-start gap-3">
                <MapPin className="text-kenya-red shrink-0" size={18} />
                <span>
                  Kasarani Sports Complex<br />
                  P.O. Box 54450 - 00200<br />
                  Nairobi, Kenya
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="text-kenya-red shrink-0" size={18} />
                <a href="tel:+254716070707" className="hover:text-white transition-colors">+254 716 070707</a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="text-kenya-red shrink-0" size={18} />
                <a href="mailto:admin@kfrs.or.ke" className="hover:text-white transition-colors">admin@kfrs.or.ke</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-gray-500 text-center md:text-left">
            &copy; {currentYear} Kenya Federation of Roller Skating (KFRS). All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <span>•</span>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
