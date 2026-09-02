export interface Leader {
  id: string;
  name: string;
  title: string;
  bio: string;
  image: string;
  role: "president" | "executive" | "technical";
}

export interface Discipline {
  id: string;
  name: string;
  description: string;
  image: string;
  icon?: string;
}

export interface EventItem {
  id: string;
  title: string;
  date: string;
  venue: string;
  category: string;
  image: string;
  status: "upcoming" | "past" | "ongoing";
  description: string;
}

export interface ClubPartner {
  id: string;
  name: string;
  type: "club" | "partner";
  county?: string;
  logo: string;
  contact?: string;
}

export interface ContactFormData {
  fullName: string;
  email: string;
  phone: string;
  category: string;
  subject: string;
  message: string;
}
