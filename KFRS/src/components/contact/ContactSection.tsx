import { useState } from "react";
import { Send, MapPin, Phone, Mail, CheckCircle2, AlertCircle } from "lucide-react";

// TODO: Replace with your actual Formspree endpoint or EmailJS details
const FORMSPREE_ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID_HERE";

export function ContactSection() {
  const [formStatus, setFormStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormStatus("submitting");
    setErrorMessage("");
    
    const form = e.currentTarget;
    const formData = new FormData(form);
    
    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
        },
      });

      if (response.ok) {
        setFormStatus("success");
        form.reset();
        // Reset form after a few seconds
        setTimeout(() => setFormStatus("idle"), 5000);
      } else {
        const data = await response.json();
        if (Object.hasOwn(data, "errors")) {
          setErrorMessage(data.errors.map((err: any) => err.message).join(", "));
        } else {
          setErrorMessage("Oops! There was a problem submitting your form.");
        }
        setFormStatus("error");
      }
    } catch (error) {
      setErrorMessage("Oops! There was a problem submitting your form. Please try again.");
      setFormStatus("error");
    }
  };

  return (
    <section id="contact" className="py-20 lg:py-28 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 text-kenya-red font-semibold mb-4 justify-center">
            <span className="w-8 h-1 bg-kenya-red rounded-full" />
            Get in Touch
            <span className="w-8 h-1 bg-kenya-red rounded-full" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
            Contact the Federation
          </h2>
          <p className="text-lg text-gray-600">
            Have questions about events, club affiliation, or sponsorships? Our team is here to help.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-12 bg-white rounded-3xl overflow-hidden shadow-xl border border-gray-100">
          
          {/* Contact Info Sidebar */}
          <div className="bg-kenya-black text-white p-10 lg:p-12 relative overflow-hidden">
            {/* Background design */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-kenya-red rounded-full blur-[100px] opacity-20 -mr-20 -mt-20 pointer-events-none" />
            
            <h3 className="text-2xl font-bold mb-8 relative z-10">Contact Information</h3>
            
            <div className="space-y-8 relative z-10">
              <div className="flex gap-4">
                <div className="shrink-0 p-3 bg-white/10 rounded-lg h-fit text-kenya-gold">
                  <MapPin size={24} />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Office Location</h4>
                  <p className="text-gray-400">
                    Kasarani Sports Complex<br />
                    P.O. Box 54450 - 00200<br />
                    Nairobi, Kenya
                  </p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="shrink-0 p-3 bg-white/10 rounded-lg h-fit text-kenya-gold">
                  <Phone size={24} />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Phone Number</h4>
                  <a href="tel:+254716070707" className="text-gray-400 hover:text-white transition-colors">
                    +254 716 070707
                  </a>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="shrink-0 p-3 bg-white/10 rounded-lg h-fit text-kenya-gold">
                  <Mail size={24} />
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Email Address</h4>
                  <a href="mailto:admin@kfrs.or.ke" className="text-gray-400 hover:text-white transition-colors">
                    admin@kfrs.or.ke
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div className="lg:col-span-2 p-10 lg:p-12">
            {formStatus === "success" ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-12">
                <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center text-kenya-green mb-4">
                  <CheckCircle2 size={40} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">Message Sent!</h3>
                <p className="text-gray-600 max-w-md mx-auto">
                  Thank you for reaching out to KFRS. We have received your message and will get back to you shortly.
                </p>
                <button 
                  onClick={() => setFormStatus("idle")}
                  className="mt-6 text-kenya-red font-semibold hover:underline"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {formStatus === "error" && (
                  <div className="p-4 bg-red-50 text-red-600 rounded-lg flex items-center gap-3">
                    <AlertCircle size={20} />
                    <p className="text-sm font-medium">{errorMessage}</p>
                  </div>
                )}
                
                {/* Formspree requires a name attribute on inputs */}
                <input type="hidden" name="_subject" value="New Submission from KFRS Website!" />
                <input type="hidden" name="_replyto" value="%email%" />
                
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="name" className="text-sm font-medium text-gray-700">Full Name</label>
                    <input 
                      type="text" 
                      id="name" 
                      name="name"
                      required
                      minLength={2}
                      className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-kenya-red focus:ring-2 focus:ring-kenya-red/20 outline-none transition-all"
                      placeholder="Jane Doe"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-gray-700">Email Address</label>
                    <input 
                      type="email" 
                      id="email" 
                      name="email"
                      required
                      className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-kenya-red focus:ring-2 focus:ring-kenya-red/20 outline-none transition-all"
                      placeholder="jane@example.com"
                    />
                  </div>
                </div>
                
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="phone" className="text-sm font-medium text-gray-700">Phone Number</label>
                    <input 
                      type="tel" 
                      id="phone" 
                      name="phone"
                      className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-kenya-red focus:ring-2 focus:ring-kenya-red/20 outline-none transition-all"
                      placeholder="+254 700 000000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="category" className="text-sm font-medium text-gray-700">Inquiry Type</label>
                    <select 
                      id="category"
                      name="category"
                      required
                      className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-kenya-red focus:ring-2 focus:ring-kenya-red/20 outline-none transition-all bg-white"
                    >
                      <option value="">Select a topic...</option>
                      <option value="affiliation">Club Affiliation</option>
                      <option value="events">Event Registration</option>
                      <option value="sponsorship">Sponsorship</option>
                      <option value="coaching">Coaching/Certification</option>
                      <option value="general">General Inquiry</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="message" className="text-sm font-medium text-gray-700">Message</label>
                  <textarea 
                    id="message" 
                    name="message"
                    required
                    minLength={10}
                    rows={4}
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-kenya-red focus:ring-2 focus:ring-kenya-red/20 outline-none transition-all resize-none"
                    placeholder="How can we help you?"
                  ></textarea>
                </div>

                <button 
                  type="submit" 
                  disabled={formStatus === "submitting"}
                  className="w-full bg-kenya-red hover:bg-kenya-red/90 disabled:bg-kenya-red/50 text-white font-bold py-4 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-md cursor-pointer disabled:cursor-not-allowed"
                >
                  {formStatus === "submitting" ? (
                    "Sending..."
                  ) : (
                    <>
                      Send Message
                      <Send size={18} />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
