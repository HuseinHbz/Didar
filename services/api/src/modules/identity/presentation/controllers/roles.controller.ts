import { asRoleId, asUserId } from '@iecp/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AssignRoleUseCase } from '../../application/rbac/assign-role.usecase';
import { CreateRoleUseCase } from '../../application/rbac/create-role.usecase';
import { ListRolesUseCase } from '../../application/rbac/list-roles.usecase';
import { UnassignRoleUseCase } from '../../application/rbac/unassign-role.usecase';
import { UpdateRoleUseCase } from '../../application/rbac/update-role.usecase';
import { RequireModule } from '../decorators/require-module.decorator';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from '../dto/role.dto';

/** blueprint §53 RBAC administration — role CRUD and role↔user assignment.
 * Reading the registry only needs module access; creating, editing, or
 * assigning a role needs the explicit `identity.roles.manage` permission. */
@ApiTags('roles')
@Controller()
export class RolesController {
  constructor(
    private readonly listRoles: ListRolesUseCase,
    private readonly createRole: CreateRoleUseCase,
    private readonly updateRole: UpdateRoleUseCase,
    private readonly assignRole: AssignRoleUseCase,
    private readonly unassignRole: UnassignRoleUseCase,
  ) {}

  @Get('roles')
  @RequireModule('identity')
  @ApiOkResponse({ type: [RoleResponseDto] })
  async list(): Promise<RoleResponseDto[]> {
    const roles = await this.listRoles.execute();
    return roles.map((role) => RoleResponseDto.fromDomain(role));
  }

  @Post('roles')
  @RequirePermission('identity.roles.manage')
  @ApiOkResponse({ type: RoleResponseDto })
  async create(@Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    const role = await this.createRole.execute({
      name: dto.name,
      description: dto.description,
      parentId: dto.parentId ? asRoleId(dto.parentId) : null,
    });
    return RoleResponseDto.fromDomain(role);
  }

  @Patch('roles/:id')
  @RequirePermission('identity.roles.manage')
  @ApiOkResponse({ type: RoleResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    const role = await this.updateRole.execute(asRoleId(id), {
      name: dto.name,
      description: dto.description,
      parentId:
        dto.parentId === undefined ? undefined : dto.parentId ? asRoleId(dto.parentId) : null,
    });
    return RoleResponseDto.fromDomain(role);
  }

  @Post('users/:userId/roles/:roleId')
  @RequirePermission('identity.roles.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async assign(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    await this.assignRole.execute(asUserId(userId), asRoleId(roleId));
  }

  @Delete('users/:userId/roles/:roleId')
  @RequirePermission('identity.roles.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unassign(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    await this.unassignRole.execute(asUserId(userId), asRoleId(roleId));
  }
}
