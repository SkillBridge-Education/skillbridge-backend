"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLearningGoalInput = exports.parseSkillInput = exports.parseUpdateProfileInput = void 0;
const httpError_1 = require("./httpError");
const MAX_SHORT_TEXT_LENGTH = 120;
const MAX_LONG_TEXT_LENGTH = 1000;
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const optionalTrimmedString = (value, fieldName, maxLength = MAX_SHORT_TEXT_LENGTH) => {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (typeof value !== "string")
        throw new httpError_1.HttpError(400, `${fieldName} must be a string`);
    const trimmed = value.trim();
    if (trimmed.length === 0)
        return null;
    if (trimmed.length > maxLength)
        throw new httpError_1.HttpError(400, `${fieldName} must be ${maxLength} characters or fewer`);
    return trimmed;
};
const requiredSkillReference = (input) => {
    if (!input.skillId && !input.name)
        throw new httpError_1.HttpError(400, "skillId or name is required");
};
const parseUpdateProfileInput = (body) => {
    if (!isObject(body))
        throw new httpError_1.HttpError(400, "Request body must be an object");
    const firstName = optionalTrimmedString(body.firstName, "firstName");
    const lastName = optionalTrimmedString(body.lastName, "lastName");
    if (firstName === null || lastName === null) {
        throw new httpError_1.HttpError(400, "firstName and lastName cannot be empty");
    }
    const input = {
        firstName,
        lastName,
        bio: optionalTrimmedString(body.bio, "bio", MAX_LONG_TEXT_LENGTH),
        avatarUrl: optionalTrimmedString(body.avatarUrl, "avatarUrl", 500),
        bannerUrl: optionalTrimmedString(body.bannerUrl, "bannerUrl", 500),
        availability: optionalTrimmedString(body.availability, "availability", 2000),
    };
    if (Object.values(input).every((value) => value === undefined)) {
        throw new httpError_1.HttpError(400, "At least one profile field is required");
    }
    return input;
};
exports.parseUpdateProfileInput = parseUpdateProfileInput;
const parseSkillInput = (body) => {
    if (!isObject(body))
        throw new httpError_1.HttpError(400, "Request body must be an object");
    const yearsOfExperience = body.yearsOfExperience;
    if (yearsOfExperience !== undefined && yearsOfExperience !== null &&
        (typeof yearsOfExperience !== "number" || !Number.isInteger(yearsOfExperience) || yearsOfExperience < 0)) {
        throw new httpError_1.HttpError(400, "yearsOfExperience must be a non-negative integer");
    }
    const input = {
        skillId: optionalTrimmedString(body.skillId, "skillId") ?? undefined,
        name: optionalTrimmedString(body.name, "name") ?? undefined,
        description: optionalTrimmedString(body.description, "description", MAX_LONG_TEXT_LENGTH),
        category: optionalTrimmedString(body.category, "category"),
        yearsOfExperience: yearsOfExperience === undefined ? undefined : yearsOfExperience,
    };
    requiredSkillReference(input);
    return input;
};
exports.parseSkillInput = parseSkillInput;
const parseLearningGoalInput = (body) => {
    if (!isObject(body))
        throw new httpError_1.HttpError(400, "Request body must be an object");
    const input = {
        skillId: optionalTrimmedString(body.skillId, "skillId") ?? undefined,
        name: optionalTrimmedString(body.name, "name") ?? undefined,
        description: optionalTrimmedString(body.description, "description", MAX_LONG_TEXT_LENGTH),
        targetLevel: optionalTrimmedString(body.targetLevel, "targetLevel"),
    };
    requiredSkillReference(input);
    return input;
};
exports.parseLearningGoalInput = parseLearningGoalInput;
//# sourceMappingURL=profileValidation.js.map