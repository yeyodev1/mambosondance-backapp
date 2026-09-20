import { CustomError } from "../errors/customError.error";
import { Teacher } from "../models/teacher.model";
import {
  Input,
  assertObjectId,
  paginated,
  parseBool,
  parseImage,
  parseInteger,
  parsePagination,
  parseRequiredText,
  parseText,
  searchRegex,
} from "./product.service";

const SORT = { order: 1, createdAt: 1 } as const;

function applyFields(teacher: any, input: Input) {
  if (input.name !== undefined) teacher.name = parseRequiredText(input.name, "El nombre", 120);
  if (input.role !== undefined) teacher.role = parseText(input.role, "El rol", 120);
  if (input.bio !== undefined) teacher.bio = parseText(input.bio, "La biografía", 5000);
  if (input.photo !== undefined) teacher.photo = parseImage(input.photo, "La foto");
  if (input.instagram !== undefined) {
    teacher.instagram = parseText(input.instagram, "El Instagram", 300);
  }
  if (input.order !== undefined) teacher.order = parseInteger(input.order, "El orden");
  if (input.isFounder !== undefined) {
    teacher.isFounder = parseBool(input.isFounder, "El campo fundador");
  }
  if (input.isPublished !== undefined) {
    teacher.isPublished = parseBool(input.isPublished, "El estado de publicación");
  }
}

export async function listPublic() {
  return Teacher.find({ isPublished: true }).sort(SORT);
}

export async function adminList(query: Input) {
  // Son pocos: por defecto viene la lista completa en una sola página.
  const { page, limit, skip } = parsePagination(query, 100);
  const filter: Record<string, unknown> = {};
  const regex = searchRegex(query.q);
  if (regex) filter.$or = [{ name: regex }, { role: regex }];

  const [items, total] = await Promise.all([
    Teacher.find(filter).sort(SORT).skip(skip).limit(limit),
    Teacher.countDocuments(filter),
  ]);
  return paginated(items, total, page, limit);
}

async function findById(id: string) {
  assertObjectId(id, "Profesor no encontrado");
  const teacher = await Teacher.findById(id);
  if (!teacher) throw new CustomError("Profesor no encontrado", 404);
  return teacher;
}

export async function create(input: Input) {
  const teacher = new Teacher({ name: parseRequiredText(input.name, "El nombre", 120) });
  applyFields(teacher, input);
  if (input.order === undefined) {
    const last = await Teacher.findOne().sort({ order: -1 });
    teacher.order = last ? last.order + 1 : 0;
  }
  await teacher.save();
  return teacher;
}

export async function update(id: string, input: Input) {
  const teacher = await findById(id);
  applyFields(teacher, input);
  await teacher.save();
  return teacher;
}

export async function remove(id: string): Promise<void> {
  const teacher = await findById(id);
  await teacher.deleteOne();
}
